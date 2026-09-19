#!/usr/bin/env node
// Assembles src/themes/ha-neon-dark-color-theme.json from src/parts/
//
// Parts files (edit these, not the theme directly):
//   src/parts/palette.json       — named colour tokens (single source of truth)
//   src/parts/meta.json          — theme name, type, semanticHighlighting flag
//   src/parts/workbench.json     — VS Code UI / workbench colors ("colors" key)
//   src/parts/tokens-ha.json     — HA-specific TextMate token rules
//   src/parts/tokens-general.json — general language TextMate token rules, incl. Jinja2
//   src/parts/semantic.json      — semantic token colors
//
// Colour tokens: any string value "$name" or "$name@AA" in a part is resolved
// against palette.json at build time ("@AA" appends a hex alpha). Unknown
// tokens fail the build. Raw hex values still pass through untouched.
//
// Output (do not edit directly):
//   src/themes/ha-neon-dark-color-theme.json

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const partsDir = path.join(root, "src", "parts");
const outFile = path.join(root, "src", "themes", "ha-neon-dark-color-theme.json");

function readPart(name) {
    const file = path.join(partsDir, name);
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        console.error(`Error reading ${file}: ${err.message}`);
        process.exit(1);
    }
}

// ---- palette ---------------------------------------------------------------
const paletteRaw = readPart("palette.json");
const palette = {};
for (const [key, value] of Object.entries(paletteRaw)) {
    if (key.startsWith("//")) continue; // comment keys
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
        console.error(`palette.json: "${key}" must be a 6-digit hex colour, got "${value}"`);
        process.exit(1);
    }
    palette[key] = value;
}

const TOKEN_RE = /^\$([^@]+)(?:@([0-9a-fA-F]{2}))?$/;
let resolvedCount = 0;

function resolvePalette(node, ctx) {
    if (typeof node === "string") {
        const m = TOKEN_RE.exec(node);
        if (!m) return node;
        const [, name, alpha] = m;
        if (!(name in palette)) {
            console.error(`Unknown palette token "$${name}" at ${ctx}`);
            process.exit(1);
        }
        resolvedCount++;
        return palette[name] + (alpha ? alpha.toLowerCase() : "");
    }
    if (Array.isArray(node)) {
        return node.map((v, i) => resolvePalette(v, `${ctx}[${i}]`));
    }
    if (node && typeof node === "object") {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
            out[k] = resolvePalette(v, ctx ? `${ctx}.${k}` : k);
        }
        return out;
    }
    return node;
}

// ---- assemble ---------------------------------------------------------------
const meta = readPart("meta.json");
const workbench = resolvePalette(readPart("workbench.json"), "workbench");
const tokensHa = resolvePalette(readPart("tokens-ha.json"), "tokens-ha");
const tokensGeneral = resolvePalette(readPart("tokens-general.json"), "tokens-general");
const semantic = resolvePalette(readPart("semantic.json"), "semantic");

if (!Array.isArray(tokensHa)) {
    console.error("tokens-ha.json must be a JSON array");
    process.exit(1);
}
if (!Array.isArray(tokensGeneral)) {
    console.error("tokens-general.json must be a JSON array");
    process.exit(1);
}

const theme = {
    $schema: "vscode://schemas/color-theme",
    ...meta,
    colors: workbench,
    tokenColors: [...tokensHa, ...tokensGeneral],
    semanticTokenColors: semantic,
};

const prettier = require("prettier");

(async () => {
    const raw = JSON.stringify(theme, null, 2) + "\n";
    // Format through prettier so the committed output always matches what
    // `npm run lint` checks for, instead of drifting from prettier's own rules
    // (e.g. collapsing short arrays onto one line).
    const output = await prettier.format(raw, { parser: "json", filepath: outFile });
    fs.writeFileSync(outFile, output, "utf8");

    const rel = path.relative(root, outFile);
    const tokenCount = theme.tokenColors.length;
    console.log(
        `✓ Theme assembled → ${rel}  (${tokenCount} token rules: ${tokensHa.length} HA, ${tokensGeneral.length} general; ${resolvedCount} palette refs resolved from ${Object.keys(palette).length} tokens)`
    );
})();
