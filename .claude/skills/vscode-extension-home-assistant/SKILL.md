---
name: vscode-extension-home-assistant
description: >
  Context and conventions for Jason's JaseOnline/home-assistant-vscode VS Code extension fork.
  ALWAYS use this skill when working on anything in C:\Dev\projects\personal\home-assistant-vscode —
  including the HA Neon Dark theme (src/parts/), TextMate grammars (src/grammars/, syntaxes/),
  the TypeScript extension host/language server, build scripts, or packaging. Also trigger when
  Jason mentions the neon theme, token colours, card-mod grammar, scope names, JS injection,
  grammar rules, theme parts, build-theme, or wants to add/change syntax highlighting for
  Home Assistant YAML. This skill is the project memory — load it at the start of any session
  touching this repo so you don't have to re-derive what took hours to build.
---

# JaseOnline/home-assistant-vscode — Project Context

## Identity

- **Repo:** `github.com/JaseOnline/home-assistant-vscode` — personal fork of `keesschollaart81/home-assistant-vscode`
- **Local path:** `C:\Dev\projects\personal\home-assistant-vscode`
- **Publisher:** `JaseOnline`  |  **Version:** `1.1.12`  |  **VS Code engine:** `^1.99.0`
- **Language ID:** `home-assistant` (`.yaml`, `.yml`)  |  `home-assistant-jinja` (`.jinja`)

Fork-specific additions vs upstream:
| Area | Location | Purpose |
|---|---|---|
| HA Neon Dark theme | `src/themes/` + `src/parts/` | Neon VS Code colour theme for HA YAML |
| Build assembler | `scripts/build-theme.js` | Merges parts → single theme JSON |
| Card-mod CSS grammar | `src/grammars/card-mod-css.tmLanguage.json` | Syntax highlighting inside `card_mod:` blocks |
| JS block/inline grammars | `src/grammars/js-block.tmLanguage.json`, `js-inline.tmLanguage.json` | JS highlighting inside Button-Card `[[[...]]]` |
| Auth (SecretStorage) | `src/auth/` | Token + URL via VS Code SecretStorage |
| Status bar | `src/status/` | Shows HA connection state |

---

## HA Neon Dark Theme

### Architecture — Parts System

**Never edit `src/themes/ha-neon-dark-color-theme.json` directly.** It is the assembled output. Always edit the source parts in `src/parts/` and rebuild.

| Part file | Key in output | Contents |
|---|---|---|
| `src/parts/meta.json` | top-level | `name`, `type`, `semanticHighlighting` |
| `src/parts/workbench.json` | `colors` | All VS Code UI / workbench colours |
| `src/parts/tokens-ha.json` | `tokenColors` (first, HA rules) | HA-specific TextMate token rules (25 rules) |
| `src/parts/tokens-general.json` | `tokenColors` (appended, general) | General language rules incl. Jinja2 |
| `src/parts/semantic.json` | `semanticTokenColors` | Semantic token overrides |

**Build command:**
```bash
node scripts/build-theme.js
# or as part of full compile:
npm run compile
```

`npm run build:theme` runs the assembler standalone.

### Colour Palette

The theme is **neon-on-black** — pure `#0f0f0f` background, saturated neon foregrounds. Colours are intentional and consistent; don't substitute muted alternatives. Core palette:

| Colour | Hex | Used for |
|---|---|---|
| Neon blue | `#00b4ff` | Entity IDs, bracket pair 1, shadow-DOM `$:` keys |
| Neon yellow | `#ffff00` | Entity domains (prefix before `.`) |
| Neon magenta | `#ff00ff` | Entity names (part after `.`) |
| Neon pink/hot | `#ff0080` | HA keywords (automation/trigger/action), bracket pair 2, CSS block delimiters |
| Neon green | `#00FF51` | YAML property keys |
| Neon orange | `#ff9500` | Service calls |
| Neon red | `#FF0000` | Template delimiters `{{`, `}}` (bold) |
| Neon mint | `#00ffe7` | Unquoted strings, HA CSS element selectors |
| Neon teal | `#5fe8ff` | Quoted strings |
| Neon green-state | `#00ff80` | State values (on, off, etc.) |
| Purple | `#c792ea` | Template variables, numbers, CSS custom properties, bracket pair 3 |
| Lavender | `#bbadff` | YAML anchors/aliases, CSS pseudo-selectors, bracket pair 5 |
| Soft violet | `#881A94` | YAML punctuation (colons, dashes) |
| Neon amber | `#ffe600` | Editor warnings, bracket pair 4 |
| card-mod key | `#ff4d73` | `card_mod:` key itself (bold), error foreground |
| Orange alt | `#ff7300` | `entity.name.tag.homeassistant` (legacy scope) |
| Off-white | `#FAFAFA` | Block strings |
| Comments | `#929292` italic | Comments |
| Body text | `#cfd8dc` | Default editor foreground |
| Background | `#0f0f0f` | Editor background |

### HA-Specific TextMate Scopes (`tokens-ha.json`)

These scopes are what the grammar emits; the theme colours them. When adding new grammar rules, define scopes here to colour them:

| Scope suffix | Colour | Meaning |
|---|---|---|
| `constant.other.entity-id.*` | `#00b4ff` | Full entity ID |
| `support.type.domain.*` | `#ffff00` | Domain prefix (e.g. `light`) |
| `entity.other.entity-name.*` | `#ff00ff` | Entity name suffix (e.g. `living_room`) |
| `support.function.service.*` | `#ff9500` | Service call |
| `keyword.control.*` / `keyword.other.*` | `#ff0080` bold | HA structural keywords |
| `support.type.property-name.*` | `#00FF51` | YAML mapping keys |
| `punctuation.definition.template.*` | `#FF0000` bold | Jinja `{{` / `}}` delimiters |
| `variable.other.template.*` | `#c792ea` | Template variables |
| `constant.language.state.*` | `#00ff80` | State values |
| `string.quoted.*` | `#5fe8ff` | Quoted strings |
| `string.unquoted.plain.*` | `#00ffe7` | Unquoted strings |
| `string.unquoted.block.*` | `#FAFAFA` | Block scalars |
| `constant.numeric.*` | `#c792ea` | Numbers |
| `comment.line.*` | `#929292` italic | Comments |
| `entity.name.type.anchor.*` | `#bbadff` | YAML anchors |
| `variable.other.alias.*` | `#bbadff` | YAML aliases |
| `punctuation.separator.key-value.*` | `#881A94` | `:` colons |
| `keyword.other.card-mod-key.*` | `#ff4d73` bold | `card_mod:` key |
| `keyword.operator.shadow-dom.*` | `#00b4ff` italic | `$:` shadow DOM keys |
| `entity.name.tag.css.ha-element.*` | `#00ffe7` | `ha-*`, `hui-*`, `mwc-*` selectors |
| `variable.other.custom-property.ha.*` | `#c792ea` | CSS `--custom-property` |
| `support.type.property-name.css.*` | `#ffe6ff` | CSS property names |
| `punctuation.section.property-list.css.*` | `#ff0080` | CSS `{` / `}` |
| `entity.other.pseudo-class.ha.*` | `#bbadff` | `:host`, `:host-context` |

All HA scopes use the suffix `.home-assistant` or `.homeassistant` — both are listed in every rule for compatibility.

---

## Grammars / Syntax Highlighting

### Grammar Files

| File | scopeName | Injects into | Purpose |
|---|---|---|---|
| `syntaxes/external/YAML.tmLanguage` | `source.home-assistant` | — (base) | Base YAML grammar |
| `syntaxes/home-assistant/jinja-*.tmLanguage` | `injection.homeassistant.jinja-*` | `source.home-assistant` | Jinja2 injection layers |
| `src/grammars/js-block.tmLanguage.json` | `js-block.injection` | `source.home-assistant`, `source.yaml` | Button-Card `[[[...]]]` JS blocks |
| `src/grammars/js-inline.tmLanguage.json` | `js-inline.injection` | `source.home-assistant`, `source.yaml` | Button-Card inline JS |
| `src/grammars/card-mod-css.tmLanguage.json` | `card-mod-css.injection` | `source.home-assistant` | CSS inside `card_mod:` block scalars |

### card-mod CSS Grammar

Injects into `source.home-assistant` and highlights:
- HA element selectors: `ha-*`, `hui-*`, `mwc-*` → `entity.name.tag.css.ha-element.homeassistant`
- CSS custom properties: `--var-name` → `variable.other.custom-property.ha.homeassistant`
- Property names → `support.type.property-name.css.homeassistant`
- Block delimiters `{`, `}` → `punctuation.section.property-list.css.homeassistant`
- Pseudo-selectors `:host`, `:host-context` → `entity.other.pseudo-class.ha.homeassistant`
- `card_mod:` key itself → `keyword.other.card-mod-key.homeassistant`
- Shadow DOM `$:` keys → `keyword.operator.shadow-dom.homeassistant`

### Track 2 — HA Entity Patterns Injection (Complete ✓)

Implemented as `src/grammars/ha-entity-patterns.tmLanguage.json` (injection into `source.home-assistant`). Three rules in priority order:

1. **`custom-card`** — `\b(custom)(:)([a-z][a-z0-9-]*)` → off-white / red / neon green
2. **`service-call`** — Oniguruma variable-length lookbehind `(?<=(?:service|action):\s{1,4})` matches only the value side of `service:` / `action:` keys → both domain and name orange
3. **`entity-id`** — 43-domain list `\b(light|switch|sensor|...)(\.)(entity_name)\b` → domain yellow / dot off-white / name magenta

Registered in `package.json` `contributes.grammars`. Three matching token rules added to `src/parts/tokens-ha.json` for the custom card scopes. Theme rebuilt (28 HA token rules total).

---

## Build & Toolchain

```bash
# Full build (theme assembly → language-service compile → schema gen → bundle)
npm run compile

# Theme only (assemble parts → src/themes/ha-neon-dark-color-theme.json)
npm run build:theme    # or: node scripts/build-theme.js

# Bundle only (esbuild extension + server)
npm run bundle

# Watch mode (bundle only, no schema regen)
npm run watch

# Lint + format
npm run lint
npm run format

# Tests (full compile first, then vscode-test integration tests)
npm test
```

**Node / toolchain setup:**
- **Node version:** `22` LTS (pinned in `.nvmrc`). Managed by **fnm** — auto-switches on `cd`. Run `fnm install 22` if a fresh machine.
- **npm/npx:** bundled with Node 22 via fnm. Available at `C:\Users\jason\.local\bin` (global prefix). No pnpm/yarn needed.
- `vsce` installed globally: `npm install -g @vscode/vsce` → lands at `C:\Users\jason\.local\bin\vsce`.

**Important build gotchas:**
- `npm install --ignore-scripts` on Windows — avoids `EINVAL` on `utf-8-validate`/`bufferutil` native bindings.
- `generateSchemas.ts` **must** run via `ts-node`, not the compiled JS — it uses `__dirname` to find `.ts` source files.
- The `compile` script runs: `build-theme.js` → `tsc` language-service → `generateSchemas.ts --quick` → `node scripts/bundle.js`.
- Bundler is esbuild (via `scripts/bundle.js`), not webpack.

**Package:**
```bash
# Build .vsix (vsce runs prepublish → node scripts/bundle.js automatically)
vsce package --no-yarn --skip-license --out ha-neon-dark-2.vsix
# Install into VS Code
code --install-extension ha-neon-dark-2.vsix --force
```

---

## Extension Architecture

### Two-Process Model

- **Extension host** (`src/extension.ts` → `out/extension.js`): VS Code process. Auth, status bar, commands, spawns language server.
- **Language server** (`src/server/server.ts` → `out/server/server.js`): Separate Node process. All YAML intelligence — completions, validation, hover, go-to-definition.

Communication: `vscode-languageclient` IPC + custom LSP requests/notifications (callService, checkConfig, getErrorLog, renderTemplate in each direction).

### Credential Flow (3-layer fallback)

1. VS Code SecretStorage (`home-assistant.token`, `home-assistant.url`)
2. Env vars (`HASS_TOKEN` / `SUPERVISOR_TOKEN`, `HASS_SERVER`)
3. Legacy `settings.json` keys (auto-migrated to SecretStorage on first use)

### HA Workspace Detection

`isHomeAssistantWorkspace()` looks for: `configuration.yaml`, `.storage/`, `home-assistant_v2.db`, `home-assistant.log`, `.HA_VERSION`, `automations.yaml`, `scripts.yaml`, `scenes.yaml`, `ui-lovelace.yaml`. Guards automatic YAML file-association to prevent hijacking non-HA projects.

---

## Known False Positives (Do Not Fix)

- **Label validator** flags `Reload`, `Lighting`, `Music` as unknown — these are valid HA labels in Jason's instance.
- **Area validator** flags `ssid`, `pwd`, `qr` — valid area names in Jason's HA config.

Do not suppress these by altering schema types.

---

## Pending Work Tracks

| Track | Status | Description |
|---|---|---|
| Track 2 | ✅ Complete | HA entity ID / service call / custom card injection grammar — done |
| Track 3 | In progress | Schema staleness fixes in `src/language-service/src/schemas/` — see detail below |

### Track 3 — Schema Staleness (In Progress)

**hass-json-schema verdict:** `C:\Dev\projects\personal\home-assistant-json-schema` is a **schema mirror, not a generator**. It re-hosts the JSON files that `generateSchemas.ts` already produces for non-VSCode editors. The Nix flake is just CI deployment tooling. There is no mechanism to auto-generate schemas from HA Python source — Track 3 means hand-fixing the TypeScript type files in `src/language-service/src/schemas/`. The naming bug (e.g. `integration-light.json` contains automation schema) exists in both the mirror and the extension's own `src/language-service/src/schemas/json/` — they are identical copies.

**Staleness diff against HA `dev` branch (as of Track 3 session):**

Functional gaps — fix these (cause false errors or missing completions):
- `set_conversation_response` action — was entirely absent from `actions.ts` → **fixed this session** (added `SetConversationResponseAction` interface and added to `Action` union)
- 6 missing selectors in `selectors.ts`: `app`, `serial_port`, `statistic`, `numeric_threshold`, `choose`, `automation_behavior`

Up to date — no action needed:
- All 17 trigger types correct, including `platform` → `trigger` rename with legacy fallback
- `StateTrigger` has `not_from` / `not_to`
- `ServiceAction.target` has `floor_id` and `label_id`
- `color_temp` (mireds) correctly absent from service call schema since HA 2026.3

Deprecation drift — low urgency (old names still work in HA, no false errors):
- Template `LightItem` missing `color_temp_kelvin`, `min_color_temp_kelvin`, `max_color_temp_kelvin` as alternatives

**Work done in Track 3 session:**
- Added `SetConversationResponseAction` interface to `actions.ts` (after `StopAction`)
- Added it to the `Action` union type
- Started `npx ts-node src/language-service/src/schemas/generateSchemas.ts` — MCP timed out before completion (expected; step takes several minutes)

**Next steps when resuming Track 3:**
1. Check if `generateSchemas` completed: tail `generate-schemas.log`; confirm `set_conversation_response` appears in `src/language-service/dist/schemas/json/integration-automation.json`
2. Rebuild vsix: `vsce package --no-yarn --skip-license --out ha-neon-dark-2.vsix`
3. Reinstall: `code --install-extension ha-neon-dark-2.vsix --force` + Developer: Reload Window
4. Test: verify `set_conversation_response:` gets completion and no squiggle in an automation
5. Next gap: add the 6 missing selectors to `selectors.ts`

---

## Key Files Quick Reference

| File | What it is |
|---|---|
| `src/parts/tokens-ha.json` | HA-specific token colour rules — **edit this for theme colour changes to HA syntax** |
| `src/parts/tokens-general.json` | General token rules (Jinja2, JS, CSS, etc.) |
| `src/parts/workbench.json` | All VS Code UI colours |
| `src/parts/semantic.json` | Semantic token overrides |
| `src/themes/ha-neon-dark-color-theme.json` | **Assembled output — do not edit directly** |
| `scripts/build-theme.js` | Theme assembler |
| `src/grammars/card-mod-css.tmLanguage.json` | card-mod CSS injection grammar |
| `src/grammars/ha-entity-patterns.tmLanguage.json` | Entity ID / service call / custom card injection grammar (Track 2) |
| `src/grammars/js-block.tmLanguage.json` | Button-Card JS block injection |
| `syntaxes/external/YAML.tmLanguage` | Base YAML grammar |
| `src/language-service/src/schemas/` | TypeScript schema source files |
| `src/language-service/dist/schemas/json/` | Generated JSON schemas (runtime) |
