// The Workers runtime types (worker-configuration.d.ts) redeclare two globals the DOM also has:
// HTMLRewriter's Element, whose append takes markup, and Body.json, which they type as unknown.
// Browser code and tests use the DOM's, so its signatures are restored here beside the Workers'.

interface Element {
  append(...nodes: (Node | string)[]): void;
}

interface Body {
  json<T = any>(): Promise<T>;
}
