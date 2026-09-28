import next from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Flat ESLint config. `eslint-config-next` 16 ships native flat configs, so no
 * compatibility shim is needed. Each subpath export is already an array.
 */
const eslintConfig = [
  ...next,
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
