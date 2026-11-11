// Describes where a tarkov.dev map label sits, from the map data around it.

const DIRECTIONS = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"];
const FACTIONS = { pmc: "PMC", scav: "Scav", shared: "PMC and Scav" };
const LANDMARK_RANGE = 400;
const BY_RANGE = 20;
const NEARBY_RANGE = 40;
const LOOT_RANGE = 30;
const BOSS_RANGE = 40;
/** Points further apart in height than this are on different floors. */
const SAME_FLOOR = 4;
const MAX_KEYS = 3;
const MAX_LOOT_KINDS = 4;
// Containers worth naming, most valuable first; drawers and duffle bags are everywhere.
const LOOT_ORDER = [
  "Safe",
  "Bank safe",
  "Weapon box",
  "Technical supply crate",
  "Medcase",
  "PC block",
  "Ration supply crate",
  "Grenade box",
  "Jacket",
  "Toolbox",
  "Cash register",
  "Plastic suitcase",
  "Dead Scav",
];
// tarkov.dev lists these AI groups among the bosses under a singular name.
const GROUPS = { Raider: "Raiders", Rogue: "Rogues" };
const STREET = /\b(?:St|Ave|Alley)\.?$/;

/** Game coordinates turned to east and north on tarkov.dev's map, which is drawn north-up. */
function onMap(rotation, { x, z }) {
  const angle = (rotation * Math.PI) / 180;
  return { east: x * Math.cos(angle) - z * Math.sin(angle), north: x * Math.sin(angle) + z * Math.cos(angle) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function sameFloor(a, b) {
  return typeof a.y !== "number" || typeof b.y !== "number" || Math.abs(a.y - b.y) <= SAME_FLOOR;
}

export function direction(rotation, from, to) {
  const a = onMap(rotation, from);
  const b = onMap(rotation, to);
  const sector = Math.round(Math.atan2(b.north - a.north, b.east - a.east) / (Math.PI / 4));
  return DIRECTIONS[(sector + 8) % 8];
}

export function aboutMetres(metres) {
  const rounded = metres < 100 ? Math.max(5, Math.round(metres / 5) * 5) : Math.round(metres / 10) * 10;
  return `about ${rounded} m`;
}

/** "the north-west", "the middle" or "the south": the third of the map a point is in. */
export function region(rotation, bounds, point) {
  const corners = [
    { x: bounds[0][0], z: bounds[0][1] },
    { x: bounds[1][0], z: bounds[1][1] },
  ].map((corner) => onMap(rotation, corner));
  const at = onMap(rotation, point);
  const share = (axis) => {
    const low = Math.min(corners[0][axis], corners[1][axis]);
    const high = Math.max(corners[0][axis], corners[1][axis]);
    return high > low ? (at[axis] - low) / (high - low) : 0.5;
  };
  const third = (value, low, high) => (value < 1 / 3 ? low : value > 2 / 3 ? high : "");
  const name = [third(share("north"), "south", "north"), third(share("east"), "west", "east")].filter(Boolean).join("-");
  return `the ${name || "middle"}`;
}

function plural(type, count) {
  const word = type === "PC block" ? "PC" : type[0].toLowerCase() + type.slice(1);
  if (count === 1) return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
  return `${count} ${word.endsWith("x") ? `${word}es` : `${word}s`}`;
}

function list(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function nearest(points, from, range, accept = () => true) {
  let best = null;
  for (const point of points) {
    const metres = distance(point, from);
    if (metres <= range && accept(point) && (!best || metres < best.metres)) best = { point, metres };
  }
  return best;
}

function exitKind(exit) {
  return exit.faction ? `${FACTIONS[exit.faction] ?? exit.faction} ${exit.kind}` : exit.kind;
}

function exitNoun(exit) {
  return exit.kind === "transit" ? exit.name : `the ${exit.name} ${exitKind(exit)}`;
}

function relation(map, label, target, noun) {
  if (target.metres < BY_RANGE) return `right by ${noun}`;
  return `${aboutMetres(target.metres)} ${direction(map.rotation, target.point, label)} of ${noun}`;
}

/**
 * One or two sentences on where a label is: the part of the map, the nearest named landmark
 * and exit, and the locks, boss spawns, and loot containers around it.
 *
 * map: { name, rotation, bounds, landmarks: [{name, exit?, x, z}], exits: [{name, kind, faction?, x, z}],
 *        locks: [{key, x, z, y?}], bosses: [{name, x, z}], loot: [{type, x, z, y?}] }
 */
export function describeLabel(map, label) {
  const same = (name) => name.toLowerCase() === label.name.toLowerCase();
  const sentences = [];

  const where = `${STREET.test(label.name) ? "A street labelled in" : "In"} ${region(map.rotation, map.bounds, label)} of ${map.name}`;
  const landmark = nearest(map.landmarks, label, LANDMARK_RANGE, (point) => !same(point.name));
  const exit = nearest(map.exits, label, Infinity, (point) => !same(point.name));
  const exitName = exit && exitNoun(exit.point);
  // A landmark that is the nearest extract is named once, as the extract.
  if (exit && landmark?.point.exit === exit.point.name) {
    sentences.push(`${where}, ${relation(map, label, exit, exitName)}.`);
  } else {
    sentences.push(landmark ? `${where}, ${relation(map, label, landmark, landmark.point.name)}.` : `${where}.`);
    if (exit) {
      const far = exit.metres < BY_RANGE ? "right here" : `${aboutMetres(exit.metres)} ${direction(map.rotation, label, exit.point)}`;
      sentences.push(`The nearest ${exitKind(exit.point)}, ${exit.point.name}, is ${far}.`);
    }
  }

  const nearby = [];
  const keys = [
    ...new Set(
      map.locks.filter((lock) => distance(lock, label) <= NEARBY_RANGE && sameFloor(lock, label)).map((lock) => lock.key)
    ),
  ];
  if (keys.length) {
    const shown = keys.slice(0, MAX_KEYS);
    const more = keys.length - shown.length;
    nearby.push(`locked doors for the ${more ? `${shown.join(", ")} and ${more} more` : list(shown)}`);
  }
  // Infected bosses only spawn during events.
  const bosses = [
    ...new Set(
      map.bosses
        .filter((boss) => !boss.name.startsWith("Infected") && distance(boss, label) <= BOSS_RANGE)
        .map((boss) => boss.name)
    ),
  ];
  if (bosses.length) nearby.push(`spawns for ${list(bosses.map((name) => GROUPS[name] ?? name))}`);
  const counts = new Map();
  for (const container of map.loot) {
    if (distance(container, label) <= LOOT_RANGE && sameFloor(container, label) && LOOT_ORDER.includes(container.type)) {
      counts.set(container.type, (counts.get(container.type) ?? 0) + 1);
    }
  }
  const loot = LOOT_ORDER.filter((type) => counts.has(type))
    .slice(0, MAX_LOOT_KINDS)
    .map((type) => plural(type, counts.get(type)));
  if (loot.length) nearby.push(`${list(loot)} within ${LOOT_RANGE} m`);
  if (nearby.length) sentences.push(`Nearby: ${nearby.join("; ")}.`);
  return sentences.join(" ");
}
