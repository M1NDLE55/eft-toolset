import { act } from "react";
import { createRoot } from "react-dom/client";

export function renderHook(hook: () => unknown) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    hook();
    return null;
  }
  act(() => root.render(<Probe />));
  return { unmount: () => act(() => root.unmount()) };
}
