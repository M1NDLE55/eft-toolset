import { describe, expect, it } from "vitest";
import { staticAssetHeaders } from "@/app/lib/security/static-headers";

function rules(file: string) {
  const parsed = new Map<string, string[]>();
  let current = "";
  for (const line of file.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("  ")) parsed.get(current)!.push(line.trim());
    else parsed.set((current = line), []);
  }
  return parsed;
}

describe("the static assets' _headers file", () => {
  const parsed = rules(staticAssetHeaders());

  it("lets browsers keep content-hashed build files for a year", () => {
    expect(parsed.get("/assets/*")).toEqual(["Cache-Control: public, max-age=31536000, immutable"]);
  });

  it("never caches the service worker, and sends HSTS only on the production hosts", () => {
    expect(parsed.get("/sw.js")).toEqual(["Cache-Control: no-cache, no-store, must-revalidate"]);
    expect(parsed.get("https://www.eft-toolset.com/*")?.[0]).toMatch(/^Strict-Transport-Security: /);
    expect(parsed.get("/*")?.some((line) => line.startsWith("Strict-Transport-Security"))).toBe(false);
  });
});
