import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // @next/next/no-page-custom-font is written for the pages router: it
  // assumes a font <link> outside pages/_document.js loads for one page only
  // and (because it never finds "pages" in the path) fires on every file. The
  // root layout of the app router wraps every page, so the Google Sans
  // stylesheet in app/layout.tsx does load site-wide. next/font cannot replace
  // it: it has no "Google Sans Text" family, and swapping fonts is out of scope.
  {
    files: ["app/layout.tsx"],
    rules: { "@next/next/no-page-custom-font": "off" },
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
