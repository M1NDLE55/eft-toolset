// Rebuilds data/wiki from the wiki's published dump; options in DATA_ARCHITECTURE.md.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import SevenZip from "7z-wasm";
import { buildSnapshot, isNewer } from "./wiki-snapshot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "wiki");
const DEFAULT_URL = "https://s3.amazonaws.com/wikia_xml_dumps/e/es/escapefromtarkov_gamepedia_pages_current.xml.7z";
const USER_AGENT = "EFT-Toolset/1.0 (+https://www.eft-toolset.com; https://github.com/M1NDLE55/eft-toolset/issues)";

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(join(OUT, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

async function check(url, manifest) {
  const response = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HEAD ${url}: HTTP ${response.status}`);
  const published = {
    lastModified: response.headers.get("last-modified"),
    bytes: Number(response.headers.get("content-length")),
  };
  console.log(JSON.stringify({ newer: isNewer(manifest, published), published, current: manifest?.source ?? null }));
}

async function download(url, directory) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  const path = join(directory, basename(new URL(url).pathname));
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return { path, lastModified: response.headers.get("last-modified") };
}

async function unpack(archive, directory) {
  const sevenZip = await SevenZip({ print: () => {}, printErr: (line) => console.error(line) });
  sevenZip.FS.mkdir("/work");
  sevenZip.FS.mount(sevenZip.NODEFS, { root: directory }, "/work");
  sevenZip.FS.chdir("/work");
  sevenZip.callMain(["x", "-y", "-ounpacked", basename(archive)]);
  const names = (await readdir(join(directory, "unpacked"))).filter((name) => name.endsWith(".xml"));
  if (names.length !== 1) throw new Error(`Expected one .xml in ${archive}, found ${names.length}`);
  return join(directory, "unpacked", names[0]);
}

async function main() {
  const manifest = await readManifest();
  const url = option("--url") ?? manifest?.source?.url ?? DEFAULT_URL;
  if (process.argv.includes("--check")) return check(url, manifest);

  const work = await mkdtemp(join(tmpdir(), "wiki-dump-"));
  try {
    let input = option("--file");
    if (input && !input.endsWith(".7z")) throw new Error("--file takes the dump as published, a .7z file.");
    let lastModified = null;
    if (input) {
      // Keep the archive's own folder untouched: unpack a copy.
      const copy = join(work, basename(input));
      await writeFile(copy, await readFile(input));
      input = copy;
    } else {
      ({ path: input, lastModified } = await download(url, work));
    }
    const bytes = await readFile(input);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    lastModified ??= option("--last-modified") ?? (manifest?.source?.sha256 === sha256 ? manifest.source.lastModified : null);
    const xmlPath = await unpack(input, work);
    const source = { url, file: basename(new URL(url).pathname), bytes: bytes.length, sha256, ...(lastModified ? { lastModified } : {}) };
    const { files, manifest: built } = buildSnapshot(await readFile(xmlPath, "utf8"), source);
    await rm(join(OUT, "pages"), { recursive: true, force: true });
    for (const [path, json] of files) {
      await mkdir(dirname(join(OUT, path)), { recursive: true });
      await writeFile(join(OUT, path), json);
    }
    console.log(
      `Wrote ${built.pages} pages (${built.pageBytes.toLocaleString("en-US")} bytes), ${built.redirects} redirects, ${built.leftOut} left-out titles; snapshot of ${built.snapshotDate}.`
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
