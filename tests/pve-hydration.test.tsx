import { act, type ComponentProps } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPathname } from "@/app/lib/game-mode-routes";

// What the router's usePathname returns while the server renders and while the browser hydrates.
let pathname = "/";
vi.mock("@/app/lib/navigation/hooks", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: () => undefined, prefetch: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock("@/app/lib/navigation/image", () => ({ default: () => null }));
vi.mock("@/app/lib/navigation/link", () => ({
  default: ({ href, prefetch: _prefetch, children, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a {...props} href={String(href)}>
      {children}
    </a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { Header } = await import("@/app/components/global/header");
const { GameModeProvider } = await import("@/components/game-mode/context");

function Page() {
  return (
    <GameModeProvider>
      <Header />
    </GameModeProvider>
  );
}

/** Renders on the server at one path and hydrates at another; returns React's hydration complaints. */
async function hydrateAcross(serverPath: string, clientPath: string) {
  pathname = serverPath;
  const html = renderToString(<Page />);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  pathname = clientPath;
  const problems: string[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => {
    problems.push(args.map(String).join(" "));
  });
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Page />, { onRecoverableError: (error) => problems.push(String(error)) });
    });
  } finally {
    await act(async () => root?.unmount());
    consoleError.mockRestore();
  }
  return { html, problems };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PVE pages", () => {
  it("strip the old PVE prefix from paths, and only that", () => {
    expect(publicPathname("/pve/item/hand-drill")).toBe("/item/hand-drill");
    expect(publicPathname("/pve")).toBe("/");
    expect(publicPathname("/item/hand-drill")).toBe("/item/hand-drill");
    expect(publicPathname("/flea-market/pve")).toBe("/flea-market/pve");
    expect(publicPathname("/pvelike")).toBe("/pvelike");
  });

  it("hydrate the header without a mismatch in a browser whose saved mode is PVE", async () => {
    // The server renders a PVE visitor's page from the cookie; the header reads the saved mode only once hydrated.
    localStorage.setItem("eft-toolset:settings:game-mode", JSON.stringify({ version: 1, data: "pve" }));
    try {
      for (const path of ["/item/hand-drill", "/quests/debut", "/gun-builder/best/m4a1"]) {
        const { html, problems } = await hydrateAcross(path, path);
        expect(problems, path).toEqual([]);
        // The section the page is in is marked current on the server too.
        expect(html).toMatch(/<a aria-current="page"[^>]*href="\/(item|quests|gun-builder)"/);
        document.body.innerHTML = "";
      }
    } finally {
      localStorage.clear();
    }
  });
});
