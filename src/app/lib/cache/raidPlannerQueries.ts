/**
 * Raid-planner map data. The `name` filter is fuzzy upstream (e.g. "factory"
 * also returns Night Factory), so callers must match `normalizedName` exactly.
 */
export const MAP_DETAILS = /* GraphQL */ `
  query MapDetails($gameMode: GameMode, $name: [String!]) {
    maps(gameMode: $gameMode, name: $name) {
      normalizedName
      players
      raidDuration
      extracts {
        id
        name
        faction
        position { x y z }
        outline { x z }
        top
        bottom
      }
      transits {
        id
        description
        position { x y z }
      }
      spawns {
        zoneName
        position { x y z }
        sides
        categories
      }
      locks {
        lockType
        needsPower
        position { x y z }
        key { id name }
      }
      hazards {
        hazardType
        name
        position { x y z }
        outline { x z }
        top
        bottom
      }
      lootContainers {
        position { x y z }
        lootContainer { normalizedName name }
      }
      switches {
        id
        name
        position { x y z }
      }
      stationaryWeapons {
        position { x y z }
        stationaryWeapon { name }
      }
      bosses {
        boss { name }
        spawnChance
      }
    }
  }
`;
