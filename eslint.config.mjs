import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Components run in the browser. Server modules (API keys, the Supabase
  // service-role client, DB access) may only be imported for their types.
  {
    files: ["app/components/**/*.{ts,tsx}", "app/HomePage.tsx", "lib/slip-optimizer.ts", "lib/leg-grades.ts", "lib/odds-math.ts", "lib/slate.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/supabase-admin",
                "**/supabase/server",
                "**/entitlement",
                "**/leg-board",
                "**/leg-compliance",
                "**/prop-edges",
                "**/stale-lines",
                "**/council",
                "**/ai-council",
                "**/base-council",
                "**/scout",
                "**/settle",
                "**/stripe",
                "**/email",
                "**/notifications",
                "**/cron-auth",
                "**/parlay-engine",
                "**/daily-cron",
                "**/dfs-scan",
                "**/lib/research/*",
                "**/research/nfl*",
              ],
              allowTypeImports: true,
              message: "Server-only module: import types only (`import type`), or move the value to a client-safe file.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
