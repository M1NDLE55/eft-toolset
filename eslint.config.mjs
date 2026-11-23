import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/navigation",
              importNames: ["usePathname"],
              message:
                "Use usePublicPathname from @/components/game-mode/use-public-pathname: PVE copies render at /pve/… on the server, so the raw path breaks hydration.",
            },
          ],
          patterns: [
            {
              group: ["next/dist/client/components/navigation*"],
              importNames: ["usePathname"],
              message: "Use usePublicPathname from @/components/game-mode/use-public-pathname.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
