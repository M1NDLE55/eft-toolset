import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSection } from "@/app/components/settings/account-section";

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error("Timed out waiting for the account section.");
}

function respondWith(body: unknown, status = 200) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));
}

describe("settings account section", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, "", "/settings");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("offers sign-in and sign-up when signed out", async () => {
    respondWith({ configured: true, user: null });
    act(() => root.render(<AccountSection />));
    await waitFor(() => host.textContent?.includes("not signed in") ?? false);
    const links = [...host.querySelectorAll("a")].map((link) => [link.textContent?.trim(), link.getAttribute("href")]);
    expect(links).toEqual([
      ["Sign in", "/auth/sign-in"],
      ["Create account", "/auth/sign-in?screen=sign-up"],
    ]);
  });

  it("shows the account with sign-out and delete when signed in", async () => {
    respondWith({ configured: true, user: { email: "player@example.com", name: "Tarkov Player", createdAt: "2026-01-02T03:04:05.000Z" } });
    act(() => root.render(<AccountSection />));
    await waitFor(() => host.textContent?.includes("player@example.com") ?? false);
    expect(host.textContent).toContain("Tarkov Player");
    expect(host.textContent).toContain("Member since");
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent?.trim());
    expect(buttons).toEqual(["Sign out", "Delete account"]);
  });

  it("says when accounts are off, and shows the notice the sign-in routes leave behind", async () => {
    window.history.replaceState(null, "", "/settings?account=error#account");
    respondWith({ configured: false, user: null });
    act(() => root.render(<AccountSection />));
    await waitFor(() => host.textContent?.includes("aren't set up") ?? false);
    expect(host.querySelector("[role=alert]")?.textContent).toBe("Sign-in didn't finish. Try again.");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#account");
  });
});
