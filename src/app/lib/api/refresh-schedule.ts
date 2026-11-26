// When to ask tarkov.dev whether its items file (the prices) has changed. tarkov.dev rebuilds it on a
// timer, about every 10 minutes (its flea-price job runs at :08, :18, … and the file it serves is
// republished a couple of minutes later), so the next change can be predicted from the last ones:
// asking before then would only get a 304. The refresher (data-refresh-do.ts) keeps this state per
// game mode and checks only once a check is due. Pure functions over plain data, so the alignment
// can be tested against simulated schedules. See DATA_ARCHITECTURE.md ("Price feed").

export interface ScheduleConfig {
  /** The period assumed until enough changes have been seen to learn it. */
  defaultPeriodMs: number;
  /** A learned period is kept within these bounds. */
  minPeriodMs: number;
  maxPeriodMs: number;
  /** How long after the predicted change to ask: tarkov.dev's publish time wanders by some seconds. */
  marginMs: number;
  /** After a 304 at or past the predicted time, ask again after this, doubling, up to the period. */
  retryBaseMs: number;
  /** How many recent changes the period and phase are learned from. */
  historySize: number;
  /** A clock offset larger than this is taken as a bad Date header and ignored. */
  maxClockOffsetMs: number;
}

const MINUTE_MS = 60_000;

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  defaultPeriodMs: 10 * MINUTE_MS,
  minPeriodMs: 5 * MINUTE_MS,
  maxPeriodMs: 30 * MINUTE_MS,
  marginMs: MINUTE_MS,
  retryBaseMs: MINUTE_MS,
  historySize: 8,
  maxClockOffsetMs: 15 * MINUTE_MS,
};

/** The default config with every duration divided by `scale` (local simulations; see devTimeScale). */
export function scaledScheduleConfig(scale: number): ScheduleConfig {
  if (scale === 1) return DEFAULT_SCHEDULE_CONFIG;
  const { historySize, ...durations } = DEFAULT_SCHEDULE_CONFIG;
  const scaled = Object.fromEntries(Object.entries(durations).map(([key, ms]) => [key, ms / scale])) as Omit<ScheduleConfig, "historySize">;
  return { ...scaled, historySize };
}

/** How many Date-header samples the clock offset is the median of. */
const OFFSET_SAMPLES = 5;

export interface ScheduleState {
  /** Recent change times (tarkov.dev's Last-Modified, on our clock), oldest first. */
  changes: number[];
  /**
   * The newest Last-Modified seen, as tarkov.dev sent it (its clock). New changes are told apart by
   * it, not by `changes`, which move with the clock offset's estimate.
   */
  latestModifiedMs: number | null;
  /** The learned period between changes. */
  periodMs: number;
  /** The latest change on the schedule's phase; predictions count whole periods from it. */
  anchor: number | null;
  /** A change off the phase, kept until a second one confirms the schedule moved (or not). */
  offPhase: number | null;
  /** 304s since the predicted change was due. */
  retries: number;
  /** Before this, a check would only get a 304. 0: check on the next request. */
  nextCheckAt: number;
  /** tarkov.dev's clock minus ours (from its Date header), the median of recent samples. */
  clockOffsetMs: number;
  offsetSamples: number[];
}

export function initialSchedule(config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG): ScheduleState {
  return {
    changes: [],
    latestModifiedMs: null,
    periodMs: config.defaultPeriodMs,
    anchor: null,
    offPhase: null,
    retries: 0,
    nextCheckAt: 0,
    clockOffsetMs: 0,
    offsetSamples: [],
  };
}

/** Whether a check is due: whether asking tarkov.dev now could find a new file. */
export function isCheckDue(state: ScheduleState, now: number) {
  return now >= state.nextCheckAt;
}

/**
 * Notes tarkov.dev's clock from a response's Date header, taken against our clock at the middle of
 * the request. Its Last-Modified times are on its clock, so they are moved onto ours by this offset.
 */
export function observeClock(state: ScheduleState, upstreamDateMs: number | null, localMs: number, config = DEFAULT_SCHEDULE_CONFIG): ScheduleState {
  if (upstreamDateMs === null || !Number.isFinite(upstreamDateMs)) return state;
  const sample = upstreamDateMs - localMs;
  if (Math.abs(sample) > config.maxClockOffsetMs) return state;
  // The Date header has whole seconds: half a second is the expected error.
  const offsetSamples = [...state.offsetSamples, sample + 500].slice(-OFFSET_SAMPLES);
  return { ...state, offsetSamples, clockOffsetMs: median(offsetSamples) };
}

export interface CheckOutcome {
  /** When the check finished, on our clock. */
  now: number;
  /** The Last-Modified of the file tarkov.dev holds now (the new one, or the one a 304 confirmed), on its clock. */
  lastModifiedMs: number | null;
}

/**
 * The state after a check: the change it saw (if its Last-Modified is new) is added to the history,
 * the period and phase are learned again, and the next check is set:
 * - the next predicted change, plus the margin, while that is still ahead;
 * - otherwise (a 304 at or past the predicted time, or a file older than predicted) after a backoff
 *   from retryBaseMs, doubling, capped at the period and never past the next predicted change.
 */
export function recordCheck(state: ScheduleState, outcome: CheckOutcome, config = DEFAULT_SCHEDULE_CONFIG): ScheduleState {
  const { now } = outcome;
  if (outcome.lastModifiedMs === null || !Number.isFinite(outcome.lastModifiedMs)) {
    // No Last-Modified to learn from: ask again a period later, while there is demand.
    return { ...state, retries: 0, nextCheckAt: now + state.periodMs };
  }
  let next = state;
  if (state.latestModifiedMs === null || outcome.lastModifiedMs > state.latestModifiedMs) {
    // A new change. On our clock; never in the future, whatever the offset says.
    const changedAt = Math.min(outcome.lastModifiedMs - state.clockOffsetMs, now);
    next = { ...learnChange(state, changedAt, config), latestModifiedMs: outcome.lastModifiedMs };
  }
  // The change held is the newest one seen (an older Last-Modified is a lagging copy upstream).
  const held = next.changes.at(-1) ?? now;
  const expected = nextPhaseAfter(next, held + 1);
  if (expected + config.marginMs > now) return { ...next, retries: 0, nextCheckAt: expected + config.marginMs };
  // The predicted change is overdue: back off, but come back for the next predicted one.
  const retries = next.retries + 1;
  const backoff = Math.min(config.retryBaseMs * 2 ** Math.min(retries - 1, 20), next.periodMs);
  const upcoming = nextPhaseAfter(next, now) + config.marginMs;
  return { ...next, retries, nextCheckAt: Math.min(now + backoff, upcoming) };
}

/** A failed check (tarkov.dev unreachable): asked again after the same backoff as an overdue change. */
export function recordFailure(state: ScheduleState, now: number, config = DEFAULT_SCHEDULE_CONFIG): ScheduleState {
  const retries = state.retries + 1;
  const backoff = Math.min(config.retryBaseMs * 2 ** Math.min(retries - 1, 20), state.periodMs);
  return { ...state, retries, nextCheckAt: now + backoff };
}

/** The first predicted change at or after `time`: the anchor plus a whole number of periods. */
export function nextPhaseAfter(state: ScheduleState, time: number) {
  if (state.anchor === null) return time;
  const periods = Math.ceil((time - state.anchor) / state.periodMs);
  return state.anchor + Math.max(periods, 0) * state.periodMs;
}

function learnChange(state: ScheduleState, changedAt: number, config: ScheduleConfig): ScheduleState {
  const changes = [...state.changes, changedAt].slice(-config.historySize);
  const periodMs = learnPeriod(changes, state.periodMs, config);
  const withPeriod = { ...state, changes, periodMs };
  if (state.anchor === null) return { ...withPeriod, anchor: changedAt, offPhase: null };
  const tolerance = periodMs / 4;
  if (Math.abs(phaseError(changedAt, state.anchor, periodMs)) <= tolerance) {
    // On the phase: anchor on it, so a schedule that drifts a little is followed at once.
    return { ...withPeriod, anchor: changedAt, offPhase: null };
  }
  // Off the phase. If the predicted change had already failed to come (we were retrying), the
  // schedule moved: take the new phase now. Otherwise it may be an extra publish between two
  // regular ones; take it only once a second change confirms it.
  const confirmed = state.offPhase !== null && Math.abs(phaseError(changedAt, state.offPhase, periodMs)) <= tolerance;
  if (state.retries > 0 || confirmed) return { ...withPeriod, anchor: changedAt, offPhase: null };
  return { ...withPeriod, offPhase: changedAt };
}

/**
 * The period: the median of the gaps between recent changes, each divided by the whole number of
 * periods it most likely spans (so a gap over a missed cycle, or between two sparse checks, still
 * counts). Gaps under half a period (an extra publish) are left out. Needs two gaps to move.
 */
function learnPeriod(changes: number[], current: number, config: ScheduleConfig) {
  const samples: number[] = [];
  for (let index = 1; index < changes.length; index += 1) {
    const gap = changes[index] - changes[index - 1];
    if (gap < current / 2) continue;
    samples.push(gap / Math.max(1, Math.round(gap / current)));
  }
  if (samples.length < 2) return current;
  return Math.min(config.maxPeriodMs, Math.max(config.minPeriodMs, median(samples)));
}

/** How far `time` is from the nearest point on the phase through `anchor`, from -period/2 to period/2. */
function phaseError(time: number, anchor: number, periodMs: number) {
  const offset = (((time - anchor) % periodMs) + periodMs) % periodMs;
  return offset > periodMs / 2 ? offset - periodMs : offset;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
