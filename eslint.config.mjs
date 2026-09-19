// eslint.config.mjs
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import stylistic from "@stylistic/eslint-plugin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Read the gitignore file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let ignores = [];
try {
  const gitignoreContent = readFileSync(`${__dirname}/.gitignore`, "utf8");
  ignores = gitignoreContent
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"))
    .flatMap(pattern => {
      const trimmed = pattern.replace(/\/$/, "");
      // A pattern with no slash matches at any depth (gitignore semantics);
      // one with a slash is relative to the repo root.
      const base = trimmed.includes("/") ? trimmed : `**/${trimmed}`;
      // Also match everything underneath, in case the pattern names a directory.
      return [base, `${base}/**`];
    });
} catch {
  // Could not read .gitignore file, ignores will not be set
}

export default tseslint.config(
  // Global ignores: must stand alone (no other keys) to exclude files from all configs below.
  {
    ignores: ["**/node_modules/**", "**/out/**", ...ignores],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  prettierConfig,
  {
    plugins: {
      "@stylistic": stylistic
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
    rules: {
      // Base rules
      "curly": "warn",

      // TypeScript rules
      "@typescript-eslint/no-explicit-any": 0,
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/consistent-indexed-object-style": 0, // Allow index signatures

      // Stylistic rules
      "@stylistic/semi": ["warn", "always"],
      "@stylistic/quotes": ["warn", "double"],
      "@stylistic/indent": ["warn", 2],
    },
  },
);
