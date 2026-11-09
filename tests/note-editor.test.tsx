import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/app/components/raid-planner/note-editor";
import type { NotePin } from "@/app/lib/raid-planner/types";

const original: NotePin = { id: "n1", position: { x: 0, z: 0 }, title: "Before", body: "", color: "#c8b384" };

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("note editor", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });

  it("does not write edited text back over an undo when it closes", async () => {
    const onChange = vi.fn();
    const root = createRoot(host);
    const render = (note: NotePin) =>
      root.render(<NoteEditor note={note} onChange={onChange} onDelete={() => {}} onClose={() => {}} />);

    await act(async () => render(original));
    await act(async () => type(host.querySelector("input")!, "After"));
    await act(async () => vi.advanceTimersByTime(500));
    expect(onChange).toHaveBeenCalledWith({ title: "After", body: "" });

    await act(async () => render({ ...original, title: "After" }));
    await act(async () => render(original));
    expect(host.querySelector("input")!.value).toBe("Before");

    onChange.mockClear();
    await act(async () => root.unmount());
    expect(onChange).not.toHaveBeenCalled();
  });
});
