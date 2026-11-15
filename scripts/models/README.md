# Gun part models

The gun builder's 3D view draws each part with one of about forty generic low-poly models: barrels, muzzle devices, suppressors, handguards, stocks, grips, magazines, optics, rails, sights, lights and so on. They all live in one file, `public/models/gun-parts.glb`. This folder holds the scripts that make that file. Blender is needed only to rebuild it; it is not used by the app, its build, or Vercel.

## Where the models come from

They are original work, made by `gun_parts.py` from code: boxes, profiles spun round an axis, and extruded side outlines, with dimensions from general real-world knowledge. Nothing comes from Escape from Tarkov or any other game. Nothing is traced from meshes, photos or drawings, nothing is copied from a particular maker's design, and nothing carries a logo or brand name. Like the rest of the repository, the scripts and the GLB are licensed under the GPL-3.0.

The models are generic on purpose. tarkov.dev has no 3D models, and the game's models belong to Battlestate Games, so every red dot uses the same red-dot model, and so on. `src/app/lib/builds/build-scene.ts` (`partVariant`) picks a model for each part from its slot and name.

## Rebuilding

You need Blender 5.2 LTS. The official build from blender.org works unpacked anywhere, without root:

```bash
curl -LO https://download.blender.org/release/Blender5.2/blender-5.2.4-linux-x64.tar.xz
curl -LO https://download.blender.org/release/Blender5.2/blender-5.2.4.sha256
grep linux-x64.tar.xz blender-5.2.4.sha256 | sha256sum -c -
tar -xJf blender-5.2.4-linux-x64.tar.xz -C ~/Applications
```

Then, from the repository root:

```bash
BLENDER=~/Applications/blender-5.2.4-linux-x64/blender npm run models
```

This runs `gun_parts.py` in headless Blender to build and export the parts. It then quantizes them with glTF Transform (`KHR_mesh_quantization`, which three.js reads with no decoder; no Draco or meshopt). It writes:

- `public/models/gun-parts.glb`, the models;
- `src/app/lib/builds/gun-parts-model.json`, the list of models and a versioned URL for the file, which the app imports.

Commit both. The URL carries a hash of the file, so browsers and the service worker pick up a new version straight away. The build is reproducible: the same scripts and Blender version give a byte-identical file, so an unchanged rebuild leaves nothing to commit.

To look at the parts, add `-- --preview <directory>`. That renders one PNG of each part, seen from the front right, as in the app:

```bash
BLENDER=~/Applications/blender-5.2.4-linux-x64/blender npm run models -- --preview /tmp/gun-parts
```

## How a model fits its part

Each model is built in the 3D view's frame: centimetres, +X toward the muzzle, up, and the gun's right side. In Blender that is +X, +Z and -Y; the glTF export turns it to +X, +Y and +Z. Each model is sized like the box the view gives that kind of part. Beside each one is an empty named `<model>__mount` that marks where it attaches to its parent:

- the bottom of parts that sit on top of something;
- the top of parts that hang below;
- the rear of parts that run forward;
- the front of parts that run back;
- the middle of bodies and receivers.

`src/app/lib/builds/part-models.ts` says how each model fits its box:

- **Stretch** models fill the box exactly on every axis, so a 20-inch barrel is longer than a 14.5-inch one. These are barrels, handguards, stocks, receivers and rails.
- **Uniform** models keep their proportions and attach at their mount empty. These are optics, grips, sights, lights and other parts that look wrong squashed.

Models for the top of a part turn to face whichever side their part sits on. If the file doesn't load, the view draws plain boxes instead.

To add a model:

1. Add a function decorated with `@part` to `gun_parts.py`.
2. Give it a fit in `VARIANT_SPECS`.
3. Return its name from `partVariant`.
4. Rebuild.

The tests check that the GLB, the manifest and `VARIANT_SPECS` agree.
