import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Minimal component-test setup — this frontend had no test runner at all
 * before this mission (verified: no vitest/jest config anywhere, no
 * `test` script). Scoped to what the mission's own acceptance criterion
 * needs: a component test asserting the picker's commit control does not
 * render in browse mode. No React plugin: esbuild picks up `tsconfig.json`'s
 * `"jsx": "react-jsx"` on its own, so `.tsx` fixtures don't need it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
