import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Page from "@/app/data/page";
import { encodeSharePayload } from "@/app/lib/share-codec";
import { BACKUP_FORMAT, BACKUP_IMPORT_PARAM, BACKUP_VERSION, STORE_KEYS } from "@/app/lib/storage/store-keys";

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error("Timed out waiting for the page.");
}

describe("/data import links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
  });

  it("shows the linked backup for review and merges it", async () => {
    const payload = await encodeSharePayload({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date(0).toISOString(),
      stores: { [STORE_KEYS.itemGroups]: [{ name: "Injectors", items: ["Propital"] }] },
    });
    window.history.replaceState(null, "", `/data#${BACKUP_IMPORT_PARAM}=${payload}`);

    await act(async () => root.render(<Page />));
    await waitFor(() => host.textContent?.includes("Restore backup") ?? false);
    expect(host.textContent).toContain("Item groups");

    const merge = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Merge")!;
    await act(async () => merge.click());
    expect(host.textContent).toContain("Backup merged into your data.");
    expect(JSON.stringify(localStorage)).toContain("Injectors");
    expect(window.location.hash).toBe("");
  });

  it("explains a damaged link", async () => {
    window.history.replaceState(null, "", `/data#${BACKUP_IMPORT_PARAM}=not-a-backup`);
    await act(async () => root.render(<Page />));
    await waitFor(() => host.textContent?.includes("can't be used") ?? false);
  });
});
