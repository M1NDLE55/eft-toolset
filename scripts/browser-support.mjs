// The oldest browsers the site supports, and the built-in APIs that are too new for them.
//
// Chrome 109 is the last release for Windows 7 and 8.1, so it is the floor. The client build lowers
// syntax for it (CLIENT_BUILD_TARGET in vite.config.ts), but nothing polyfills built-in methods: code
// that runs in the browser must not call the APIs below. ESLint flags them in our source and the
// client build fails if one reaches the bundle, including through a dependency.

/** esbuild/Oxc targets for the client bundle: Vite's default, with Chrome and Edge back to 109. */
export const CLIENT_BUILD_TARGET = ["chrome109", "edge109", "firefox114", "safari16.4", "ios16.4"];

/**
 * Built-in methods missing from Chrome 109, with the first Chrome that has them.
 * `object` names the global the method hangs off; without it any `.name(` call matches, so only
 * names that are distinctive enough to mean the built-in are listed that way.
 *
 * @type {ReadonlyArray<{ name: string; object?: string; chrome: number; instead: string }>}
 */
export const TOO_NEW_APIS = [
  { name: "toSorted", chrome: 110, instead: "[...array].sort()" },
  { name: "toReversed", chrome: 110, instead: "[...array].reverse()" },
  { name: "toSpliced", chrome: 110, instead: "a copy and splice()" },
  { name: "with", chrome: 110, instead: "array.map() replacing the one index" },
  { name: "isWellFormed", chrome: 111, instead: "a regular expression for lone surrogates" },
  { name: "toWellFormed", chrome: 111, instead: "a regular expression for lone surrogates" },
  { name: "groupBy", object: "Object", chrome: 117, instead: "a loop into an object" },
  { name: "groupBy", object: "Map", chrome: 117, instead: "a loop into a Map" },
  { name: "any", object: "AbortSignal", chrome: 116, instead: "an AbortController that listens to each signal" },
  { name: "withResolvers", object: "Promise", chrome: 119, instead: "new Promise() keeping resolve and reject" },
  { name: "canParse", object: "URL", chrome: 120, instead: "new URL() in a try block" },
  { name: "fromAsync", object: "Array", chrome: 121, instead: "a for await loop" },
  { name: "union", chrome: 122, instead: "new Set([...a, ...b])" },
  { name: "intersection", chrome: 122, instead: "filtering one Set by the other" },
  { name: "difference", chrome: 122, instead: "filtering one Set by the other" },
  { name: "symmetricDifference", chrome: 122, instead: "filtering both Sets" },
  { name: "isSubsetOf", chrome: 122, instead: "every() over the Set" },
  { name: "isSupersetOf", chrome: 122, instead: "every() over the other Set" },
  { name: "isDisjointFrom", chrome: 122, instead: "some() over the Set" },
  { name: "from", object: "Iterator", chrome: 122, instead: "Array.from()" },
  { name: "parse", object: "URL", chrome: 126, instead: "new URL() in a try block" },
  { name: "try", object: "Promise", chrome: 128, instead: "new Promise((resolve) => resolve(fn()))" },
  { name: "escape", object: "RegExp", chrome: 136, instead: "replacing [.*+?^${}()|[\\]\\\\] by hand" },
  { name: "fromBase64", object: "Uint8Array", chrome: 140, instead: "atob()" },
  { name: "fromHex", object: "Uint8Array", chrome: 140, instead: "parsing pairs of digits" },
  { name: "toBase64", chrome: 140, instead: "btoa()" },
  { name: "sumPrecise", object: "Math", chrome: 141, instead: "a plain sum" },
];

/**
 * Dependencies whose matches are safe: they define a method of the same name on their own class, or
 * check that the built-in exists before calling it. Matched against module ids; each entry says why.
 */
export const ALLOWED_MODULES = [
  // Radix's OrderedDict (used by menus) implements its own toSorted and toReversed.
  { module: "/node_modules/@radix-ui/react-collection/", names: ["toSorted", "toReversed"] },
  // seroval (TanStack's data serialiser) calls Uint8Array#toBase64 only after checking it exists, else uses btoa().
  { module: "/node_modules/seroval/", names: ["toBase64"] },
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds calls of too-new built-ins in a module's code.
 *
 * @param {string} code
 * @param {string} [moduleId]
 * @returns {Array<{ api: string; chrome: number; instead: string }>}
 */
export function findTooNewApis(code, moduleId = "") {
  const allowed = new Set(ALLOWED_MODULES.filter((entry) => moduleId.includes(entry.module)).flatMap((entry) => entry.names));
  const found = [];
  for (const api of TOO_NEW_APIS) {
    if (allowed.has(api.name)) continue;
    // `x.name(` or `x?.name(`, or `Global.name` (also referenced without a call); never `.name` inside a longer word.
    const pattern = api.object
      ? new RegExp(`(?<![\\w$.])${escapeRegExp(api.object)}\\s*\\.\\s*${api.name}\\b`)
      : new RegExp(`\\.\\s*${api.name}\\s*\\(`);
    if (pattern.test(code)) found.push({ api: api.object ? `${api.object}.${api.name}` : `.${api.name}()`, chrome: api.chrome, instead: api.instead });
  }
  return found;
}
