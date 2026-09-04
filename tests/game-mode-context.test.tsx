import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameModeProvider, useGameMode } from "@/components/game-mode/context";

function Probe() {
  const { gameMode, hydrated, toggleGameMode } = useGameMode();
  return (
    <button
      type="button"
      data-mode={gameMode}
      data-hydrated={String(hydrated)}
      onClick={toggleGameMode}
    >
      Toggle
    </button>
  );
}

describe("game-mode hydration", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    window.localStorage.clear();
  });

  afterEach(() => {
    host.remove();
  });

  it("hydrates the saved mode before queries are enabled and persists later changes", async () => {
    window.localStorage.setItem(
      "eft-toolset:settings:game-mode",
      JSON.stringify({ version: 1, data: "pve" })
    );
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <GameModeProvider>
          <Probe />
        </GameModeProvider>
      );
    });

    const button = host.querySelector("button")!;
    expect(button.dataset.mode).toBe("pve");
    expect(button.dataset.hydrated).toBe("true");

    await act(async () => button.click());
    expect(button.dataset.mode).toBe("regular");
    expect(JSON.parse(window.localStorage.getItem("eft-toolset:settings:game-mode")!)).toEqual({
      version: 1,
      data: "regular",
    });

    await act(async () => root.unmount());
  });
});
