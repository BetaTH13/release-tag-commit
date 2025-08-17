import js from "@eslint/js";
import pluginImport from "eslint-plugin-import";

export default [
  {
    ignores: ["node_modules", "dist", "coverage"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      import: pluginImport,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      semi: ["error", "always"],
      quotes: ["error", "double"],
      "import/order": ["warn", { alphabetize: { order: "asc" } }],
    },
  },
];
