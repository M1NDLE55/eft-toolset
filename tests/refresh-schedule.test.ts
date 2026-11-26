// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE_CONFIG,
  initialSchedule,
  isCheckDue,
  nextPhaseAfter,
  observeClock,
  recordCheck,
  recordFailure,
  type ScheduleState,
} from "@/app/lib/api/refresh-schedule";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = Date.UTC(2026, 10, 26, 8, 0, 0);

/** tarkov.dev's publish times, on its own clock: `at(minute, second)` past START's hour. */
const at = (minute: number, second = 0) => START + minute * MINUTE + second * SECOND;

/** A simulated tarkov.dev: the change times it has published, and its clock's offset from ours. */
interface Upstream {
  changes: number[];
  clockOffsetMs?: number;
}

interface Run {
  state: ScheduleState;
  checks: number[];
  /** For each change seen: how long after it was published (on our clock) we first had it. */
  lags: { change: number; lagMs: number }[];
}

/** The Last-Modified tarkov.dev answers with at `now` (our clock), on its clock. */
function lastModifiedAt(upstream: Upstream, now: number) {
  const offset = upstream.clockOffsetMs ?? 0;
  const published = upstream.changes.filter((change) => change - offset <= now);
  return published.length ? published[published.length - 1] : null;
}

/** Requests every `everyMs` from `from` to `to`; each one that finds a check due makes it, as the refresher does. */
function simulate(upstream: Upstream, from: number, to: number, everyMs: number, state = initialSchedule(), useDateHeader = true): Run {
  const run: Run = { state, checks: [], lags: [] };
  let held: number | null = null;
  for (let now = from; now <= to; now += everyMs) {
    if (!isCheckDue(run.state, now)) continue;
    run.checks.push(now);
    if (useDateHeader) run.state = observeClock(run.state, Math.floor((now + (upstream.clockOffsetMs ?? 0)) / 1000) * 1000, now);
    const lastModified = lastModifiedAt(upstream, now);
    if (lastModified !== null && lastModified !== held) {
      run.lags.push({ change: lastModified, lagMs: now - (lastModified - (upstream.clockOffsetMs ?? 0)) });
      held = lastModified;
    }
    run.state = recordCheck(run.state, { now, lastModifiedMs: lastModified });
  }
  return run;
}

/** Changes every `periodMs` starting at `first`, up to `until`. */
function regular(first: number, periodMs: number, until: number) {
  const changes: number[] = [];
  for (let time = first; time <= until; time += periodMs) changes.push(time);
  return changes;
}

function checksPerHour(run: Run, from: number, to: number) {
  return run.checks.filter((time) => time >= from && time < to).length / ((to - from) / HOUR);
}

describe("the refresh schedule", () => {
  it("checks once per cycle on a steady 10-minute schedule, a margin after each change", () => {
    const upstream = { changes: regular(at(0, 23) - 10 * MINUTE, 10 * MINUTE, at(240)) };
    const run = simulate(upstream, at(0), at(240), 5 * SECOND);
    // After the first cycle, one check per change: 6 an hour.
    expect(checksPerHour(run, at(30), at(240))).toBeLessThanOrEqual(6);
    for (const { lagMs } of run.lags.slice(2)) expect(lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + 5 * SECOND);
    expect(run.state.periodMs).toBe(10 * MINUTE);
  });

  it("re-aligns within one cycle when tarkov.dev moves from :10/:20 to :11/:21", () => {
    const before = regular(at(0, 23), 10 * MINUTE, at(60, 23));
    const after = regular(at(71, 23), 10 * MINUTE, at(240));
    const run = simulate({ changes: [...before, ...after] }, at(0), at(240), 5 * SECOND);
    // The first change on the new schedule is caught a retry later, at most two minutes behind…
    const firstShifted = run.lags.find(({ change }) => change === at(71, 23))!;
    expect(firstShifted.lagMs).toBeLessThanOrEqual(2 * MINUTE + 5 * SECOND);
    // …and from the next one on, the margin behind: never stuck nine minutes late.
    for (const { change, lagMs } of run.lags) if (change > at(80)) expect(lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + 5 * SECOND);
    expect(checksPerHour(run, at(90), at(240))).toBeLessThanOrEqual(6);
  });

  it("follows a schedule that drifts, learning a period that isn't 10 minutes", () => {
    const upstream = { changes: regular(at(0, 23), 10.5 * MINUTE, at(300)) };
    const run = simulate(upstream, at(0), at(300), 5 * SECOND);
    expect(run.state.periodMs).toBeGreaterThan(10.4 * MINUTE);
    expect(run.state.periodMs).toBeLessThan(10.6 * MINUTE);
    for (const { lagMs } of run.lags.slice(4)) expect(lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + 5 * SECOND);
    expect(checksPerHour(run, at(60), at(300))).toBeLessThanOrEqual(6.5);
  });

  it("re-aligns again and again while the phase keeps creeping", () => {
    // Each change 20 seconds later in its slot than the one before: a 10:20 period, learned.
    const upstream = { changes: regular(at(0, 23), 10 * MINUTE + 20 * SECOND, at(400)) };
    const run = simulate(upstream, at(0), at(400), 5 * SECOND);
    for (const { lagMs } of run.lags.slice(4)) expect(lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + 5 * SECOND);
  });

  it("backs off after a 304 at the predicted time: a few checks for a missed cycle, not one per request", () => {
    const changes = regular(at(0, 23), 10 * MINUTE, at(120)).filter((change) => change !== at(50, 23));
    const run = simulate({ changes }, at(0), at(120), 1 * SECOND);
    const duringMiss = run.checks.filter((time) => time > at(50, 23) && time <= at(60, 23));
    // 304s at +1, +2, +4 minutes past the predicted time, then the next predicted change.
    expect(duringMiss.length).toBeGreaterThanOrEqual(2);
    expect(duringMiss.length).toBeLessThanOrEqual(4);
    // The cycle after the miss is caught on time and the period isn't thrown off.
    const next = run.lags.find(({ change }) => change === at(60, 23))!;
    expect(next.lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + SECOND);
    expect(run.state.periodMs).toBe(10 * MINUTE);
  });

  it("keeps checking, at most once a period, through a long pause in tarkov.dev's updates", () => {
    const changes = [...regular(at(0, 23), 10 * MINUTE, at(30, 23)), ...regular(at(150, 23), 10 * MINUTE, at(240))];
    const run = simulate({ changes }, at(0), at(240), SECOND);
    expect(checksPerHour(run, at(60), at(150))).toBeLessThanOrEqual(7);
    const resumed = run.lags.find(({ change }) => change === at(150, 23))!;
    expect(resumed.lagMs).toBeLessThanOrEqual(10 * MINUTE);
    for (const { change, lagMs } of run.lags) if (change > at(170)) expect(lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + SECOND);
  });

  it("isn't pulled off the schedule by an extra publish between two regular ones", () => {
    let state = initialSchedule();
    for (const change of [at(0, 23), at(10, 23), at(20, 23)]) state = recordCheck(state, { now: change + 30 * SECOND, lastModifiedMs: change });
    // A request that happened to check at :26 saw an extra publish at :25:40.
    state = recordCheck({ ...state, nextCheckAt: 0 }, { now: at(26), lastModifiedMs: at(25, 40) });
    expect(state.anchor).toBe(at(20, 23));
    expect(state.nextCheckAt).toBe(at(30, 23) + DEFAULT_SCHEDULE_CONFIG.marginMs);
    expect(state.periodMs).toBe(10 * MINUTE);
  });

  it("takes a new phase at once when the predicted change didn't come and an off-phase one did", () => {
    let state = initialSchedule();
    for (const change of [at(0, 23), at(10, 23), at(20, 23)]) state = recordCheck(state, { now: change + 30 * SECOND, lastModifiedMs: change });
    // :30:23 never came (304s at :31:23 and :32:23); the schedule jumped to :34:23.
    state = recordCheck(state, { now: at(31, 23), lastModifiedMs: at(20, 23) });
    state = recordCheck(state, { now: at(32, 23), lastModifiedMs: at(20, 23) });
    expect(state.retries).toBe(2);
    state = recordCheck(state, { now: at(34, 30), lastModifiedMs: at(34, 23) });
    expect(state.anchor).toBe(at(34, 23));
    expect(state.retries).toBe(0);
    expect(state.nextCheckAt).toBe(at(44, 23) + DEFAULT_SCHEDULE_CONFIG.marginMs);
  });

  it("corrects for tarkov.dev's clock running ahead of ours, from its Date header", () => {
    const skew = 90 * SECOND;
    const upstream = { changes: regular(at(0, 23), 10 * MINUTE, at(240)), clockOffsetMs: skew };
    const run = simulate(upstream, at(0), at(240), 5 * SECOND);
    expect(Math.abs(run.state.clockOffsetMs - skew)).toBeLessThanOrEqual(SECOND);
    for (const { lagMs } of run.lags.slice(2)) expect(lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + 5 * SECOND);
    expect(checksPerHour(run, at(30), at(240))).toBeLessThanOrEqual(6);
  });

  it("still converges without a Date header when tarkov.dev's clock is behind ours", () => {
    const upstream = { changes: regular(at(0, 23), 10 * MINUTE, at(240)), clockOffsetMs: -45 * SECOND };
    const run = simulate(upstream, at(0), at(240), 5 * SECOND, initialSchedule(), false);
    // Its times look 45 seconds early, so each check is that much later than needed: within the margin plus the skew.
    for (const { lagMs } of run.lags.slice(2)) expect(lagMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.marginMs + 50 * SECOND);
    expect(checksPerHour(run, at(30), at(240))).toBeLessThanOrEqual(6);
  });

  it("ignores a Date header that's wildly off", () => {
    const state = observeClock(initialSchedule(), START + 3 * HOUR, START);
    expect(state.clockOffsetMs).toBe(0);
  });

  it("doesn't take the same Last-Modified for a new change when its estimate of the clock offset moves", () => {
    let state = observeClock(initialSchedule(), at(1), at(1) - 2 * SECOND);
    state = recordCheck(state, { now: at(1), lastModifiedMs: at(0, 23) });
    state = observeClock(state, at(11, 30), at(11, 30));
    state = observeClock(state, at(11, 31), at(11, 31));
    state = recordCheck(state, { now: at(11, 31), lastModifiedMs: at(0, 23) });
    expect(state.changes).toHaveLength(1);
    expect(state.retries).toBe(1);
  });

  it("never dates a change in our future, whatever the offset says", () => {
    const state = recordCheck(initialSchedule(), { now: at(5), lastModifiedMs: at(9) });
    expect(state.changes).toEqual([at(5)]);
  });

  it("with sparse traffic, checks only when a request comes and learns the period from gaps of several cycles", () => {
    const upstream = { changes: regular(at(0, 23), 10 * MINUTE, at(600)) };
    const run = simulate(upstream, at(1), at(600), 25 * MINUTE + 7 * SECOND);
    // A request every 25 minutes: each finds a newer file, one check each.
    expect(run.checks.length).toBeLessThanOrEqual(Math.ceil((600 - 1) / 25) + 1);
    expect(run.state.periodMs).toBe(10 * MINUTE);
  });

  it("makes no checks without requests", () => {
    const upstream = { changes: regular(at(0, 23), 10 * MINUTE, at(240)) };
    const run = simulate(upstream, at(0), at(0), 5 * SECOND);
    expect(run.checks).toEqual([at(0)]);
    // Nothing between two requests three hours apart but the one check the second one makes.
    const later = simulate(upstream, at(180), at(180), 5 * SECOND, run.state);
    expect(later.checks).toEqual([at(180)]);
  });

  it("keeps a learned period within its bounds", () => {
    let state = initialSchedule();
    for (let index = 0; index < 8; index += 1) state = recordCheck(state, { now: at(index * 2) + SECOND, lastModifiedMs: at(index * 2) });
    expect(state.periodMs).toBeGreaterThanOrEqual(DEFAULT_SCHEDULE_CONFIG.minPeriodMs);
    state = initialSchedule();
    for (let index = 0; index < 8; index += 1) state = recordCheck(state, { now: at(index * 45) + SECOND, lastModifiedMs: at(index * 45) });
    expect(state.periodMs).toBeLessThanOrEqual(DEFAULT_SCHEDULE_CONFIG.maxPeriodMs);
  });

  it("checks PVP and PVE on their own schedules", () => {
    const pvp = simulate({ changes: regular(at(0, 23), 10 * MINUTE, at(120)) }, at(0), at(120), 5 * SECOND);
    const pve = simulate({ changes: regular(at(0, 43), 10 * MINUTE, at(120)) }, at(0), at(120), 5 * SECOND);
    // Within a second: the Date header has whole seconds.
    expect(Math.abs((nextPhaseAfter(pvp.state, at(121)) % MINUTE) - 23 * SECOND)).toBeLessThanOrEqual(SECOND);
    expect(Math.abs((nextPhaseAfter(pve.state, at(121)) % MINUTE) - 43 * SECOND)).toBeLessThanOrEqual(SECOND);
  });

  it("backs off after failures, up to a period", () => {
    let state = recordCheck(initialSchedule(), { now: at(1), lastModifiedMs: at(0, 23) });
    const delays: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const now = state.nextCheckAt;
      state = recordFailure(state, now);
      delays.push(state.nextCheckAt - now);
    }
    expect(delays).toEqual([1, 2, 4, 8, 10, 10].map((minutes) => minutes * MINUTE));
  });
});
