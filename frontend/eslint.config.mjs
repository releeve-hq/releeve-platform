import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  globalIgnores([".next/**", ".open-next/**", ".vinext/**", ".wrangler/**", "dist/**", "out/**", "build/**", "next-env.d.ts"]),
]);
