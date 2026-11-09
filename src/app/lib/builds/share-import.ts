import { MAX_SHARE_LINK_LENGTH } from "@/app/lib/share-codec";
import { decodeBuildSharePayload, type DecodedSharedBuild } from "./share";

const PAYLOAD_PATTERN = /^(?:gz\.|j\.)?[A-Za-z0-9_-]{8,}$/;
const PREFIXED_PAYLOAD_PATTERN = /^(?:gz\.|j\.)[A-Za-z0-9_-]{8,}$/;
const SHARE_PATH_PATTERN = /^\/gun-builder\/share\/[a-z0-9-]{1,80}\/?$/;
const PLACEHOLDER_ORIGIN = "https://share.invalid";

export class ShareImportError extends Error {}

export function extractSharePayload(input: string): string {
  const value = input.trim();
  if (!value) throw new ShareImportError("Paste a gun builder share link.");
  if (value.length > MAX_SHARE_LINK_LENGTH) throw new ShareImportError("That link is too long to be a build link.");
  if (/\s/.test(value)) throw new ShareImportError("Paste a single share link.");
  if (PREFIXED_PAYLOAD_PATTERN.test(value)) return value;

  const absolute = /^https?:\/\//i.test(value);
  if (!absolute && !value.startsWith("/gun-builder/share/")) {
    throw new ShareImportError("That isn't a gun builder share link.");
  }
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    throw new ShareImportError("That doesn't look like a link.");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new ShareImportError("That isn't a gun builder share link.");
  }
  if (!SHARE_PATH_PATTERN.test(url.pathname) || url.search) {
    throw new ShareImportError("That isn't a gun builder share link.");
  }
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  const keys = Array.from(params.keys());
  const payload = params.get("b");
  if (keys.length !== 1 || keys[0] !== "b" || !payload) {
    throw new ShareImportError("This link is missing its build data. Make sure you copied the whole link.");
  }
  if (!PAYLOAD_PATTERN.test(payload)) {
    throw new ShareImportError("This link is damaged or was created by an incompatible version.");
  }
  return payload;
}

export async function parseSharedBuildInput(input: string): Promise<DecodedSharedBuild> {
  const payload = extractSharePayload(input);
  try {
    return await decodeBuildSharePayload(payload);
  } catch {
    throw new ShareImportError("This link is damaged or was created by an incompatible version.");
  }
}
