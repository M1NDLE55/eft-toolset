export const GUN_LIST = `
  query GunList($gameMode: GameMode) {
    items(gameMode: $gameMode, type: gun) {
      id
      name
      shortName
      gridImageLink
      properties {
        ... on ItemPropertiesWeapon {
          defaultPreset { id }
        }
      }
    }
  }
`;

export const BUILD_ITEMS = `
  query BuildItems($ids: [ID]!, $gameMode: GameMode) {
    items(gameMode: $gameMode, ids: $ids) {
      id
      name
      shortName
      gridImageLink
      weight
      buyFor { vendor { name } priceRUB }
      conflictingItems { id }
      conflictingSlotIds
      properties {
        __typename
        ... on ItemPropertiesWeapon {
          caliber
          ergonomics
          recoilVertical
          recoilHorizontal
          fireRate
          fireModes
          defaultAmmo { name }
          defaultPreset { id }
          presets { id name }
          slots { id name nameId required filters { allowedItems { id } } }
        }
        ... on ItemPropertiesWeaponMod {
          ergonomics
          recoilModifier
          accuracyModifier
          slots { id name nameId required filters { allowedItems { id } } }
        }
        ... on ItemPropertiesScope {
          ergonomics
          recoilModifier
          zoomLevels
          slots { id name nameId required filters { allowedItems { id } } }
        }
        ... on ItemPropertiesMagazine {
          ergonomics
          recoilModifier
          capacity
          slots { id name nameId required filters { allowedItems { id } } }
        }
        ... on ItemPropertiesBarrel {
          ergonomics
          recoilModifier
          slots { id name nameId required filters { allowedItems { id } } }
        }
      }
    }
  }
`;

export const PICK_ITEMS = `
  query PickItems($ids: [ID]!, $gameMode: GameMode) {
    items(gameMode: $gameMode, ids: $ids) {
      id
      name
      shortName
      gridImageLink
      weight
      buyFor { vendor { name } priceRUB }
      conflictingItems { id }
      conflictingSlotIds
      properties {
        __typename
        ... on ItemPropertiesWeaponMod { ergonomics recoilModifier }
        ... on ItemPropertiesScope { ergonomics recoilModifier }
        ... on ItemPropertiesMagazine { ergonomics recoilModifier }
        ... on ItemPropertiesBarrel { ergonomics recoilModifier }
      }
    }
  }
`;

export const PRESET_DETAIL = `
  query Preset($id: ID!, $gameMode: GameMode) {
    items(gameMode: $gameMode, ids: [$id]) {
      properties {
        ... on ItemPropertiesPreset {
          baseItem { id }
          moa
        }
      }
      containsItems {
        item { id }
        attributes { name value }
      }
    }
  }
`;
