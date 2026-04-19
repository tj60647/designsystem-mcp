/**
 * Build helper: copies the design system data files (tokens.json, components.json)
 * from src/data/ into dist/data/ after tsc compiles the TypeScript source.
 *
 * TypeScript's compiler only emits .js files — it does not copy static assets
 * like JSON data files. This script fills that gap so the compiled server can
 * find its data at runtime.
 *
 * Author: Thomas J McLeish
 * License: MIT
 */

import { mkdirSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const root       = join(__dirname, "..");   // repo root (one level up from scripts/)
const srcData    = join(root, "src",  "data");
const distData   = join(root, "dist", "data");

// Create dist/data/ if it doesn't exist yet
mkdirSync(distData, { recursive: true });

// Copy each data file
const files = ["tokens.json", "components.json", "themes.json", "icons.json", "changelog.json", "deprecations.json", "style-guide.json"];
for (const file of files) {
  copyFileSync(join(srcData, file), join(distData, file));
  console.log(`  copied  src/data/${file}  →  dist/data/${file}`);
}

console.log("Data files ready in dist/data/");
