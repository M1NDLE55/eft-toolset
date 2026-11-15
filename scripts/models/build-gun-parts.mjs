// SPDX-License-Identifier: GPL-3.0-or-later
// Builds public/models/gun-parts.glb: runs scripts/models/gun_parts.py in headless Blender, then
// quantizes the result with glTF Transform (KHR_mesh_quantization, which three.js reads without
// a decoder) and writes a manifest the app imports. See scripts/models/README.md.
//
//   npm run models                     # build the GLB and manifest
//   npm run models -- --preview <dir>  # also render one PNG per part to <dir>
//
// Blender is found through $BLENDER, or `blender` on the PATH.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, quantize } from "@gltf-transform/functions";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = join(root, "public/models/gun-parts.glb");
const MANIFEST = join(root, "src/app/lib/builds/gun-parts-model.json");

const args = process.argv.slice(2);
const previewIndex = args.indexOf("--preview");
const preview = previewIndex === -1 ? null : resolve(args[previewIndex + 1] ?? "");

const blender = process.env.BLENDER || "blender";
const work = mkdtempSync(join(tmpdir(), "gun-parts-"));
const raw = join(work, "raw.glb");

try {
  const result = spawnSync(
    blender,
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      join(root, "scripts/models/gun_parts.py"),
      "--",
      "--out",
      raw,
      ...(preview ? ["--preview", preview] : []),
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  if (result.error) {
    throw new Error(
      `Could not run Blender (${blender}): ${result.error.message}. Set BLENDER to the blender executable.`
    );
  }
  if (result.status !== 0) throw new Error(`Blender exited with status ${result.status}.`);

  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const document = await io.read(raw);
  // Positions to 14 bits and normals to 10 are invisible at this size. No Draco or meshopt, so
  // the browser needs no decoder.
  await document.transform(dedup(), quantize({ quantizePosition: 14, quantizeNormal: 10 }));
  const glb = await io.writeBinary(document);
  writeFileSync(OUTPUT, glb);

  const nodes = document.getRoot().listNodes();
  const variants = nodes
    .filter((node) => node.getMesh())
    .map((node) => node.getName())
    .sort();
  const missingMounts = variants.filter((name) => !nodes.some((node) => node.getName() === `${name}__mount`));
  if (missingMounts.length) throw new Error(`Parts without a mount empty: ${missingMounts.join(", ")}`);

  const version = createHash("sha256").update(glb).digest("hex").slice(0, 12);
  const manifest = { url: `/models/gun-parts.glb?v=${version}`, variants };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const kb = (readFileSync(OUTPUT).length / 1024).toFixed(1);
  console.log(`Wrote ${OUTPUT} (${variants.length} parts, ${kb} KiB) and ${MANIFEST}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
