import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { TOO_NEW_APIS } from "./scripts/browser-support.mjs";

// The rules the site has always been linted with (React, the hooks and React Compiler rules, and
// the accessibility checks), without the Next.js plugin.
export default defineConfig([
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts}"],
    plugins: { react, "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    plugins: { "@typescript-eslint": tseslint.plugin },
  },
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/app/lib/navigation/hooks",
              importNames: ["usePathname"],
              message: "Use usePublicPathname from @/components/game-mode/use-public-pathname, which drops the old /pve prefix.",
            },
          ],
        },
      ],
    },
  },
  {
    // Built-ins newer than Chrome 109 (scripts/browser-support.mjs) in code that can run in the browser.
    // The client build checks the bundle too; this flags them while editing. Server-only code may use them.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/lib/mcp/**", "src/app/lib/server/**", "src/**/*-server.ts", "src/server.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...TOO_NEW_APIS.map((api) => ({
          ...(api.object ? { object: api.object } : {}),
          property: api.name,
          message: `Needs Chrome ${api.chrome} and the site supports 109; use ${api.instead}.`,
        })),
      ],
    },
  },
  globalIgnores(["dist/**", ".wrangler/**", "src/routeTree.gen.ts", "worker-configuration.d.ts", "data/**"]),
]);
