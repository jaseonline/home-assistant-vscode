# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Fork Identity

This is a personal fork (`JaseOnline/home-assistant-vscode`) of `keesschollaart81/vscode-home-assistant` (git remote `upstream`). Fork-specific additions live in:
- `src/themes/` — HA Neon Dark colour theme (embedded, replaces the standalone `ha-neon-dark` extension). **Generated — do not edit.**
- `src/parts/` — Theme source. `scripts/build-theme.js` (`npm run build:theme`, also run by `compile`) assembles it into `src/themes/ha-neon-dark-color-theme.json`. Colours reference `palette.json` tokens (`$name`, `$name@AA`); an unknown token fails the build. `home-assistant.yaml` / `my_neumorphic.yaml` in that folder are not read by the build.
- `src/grammars/` — Injection grammars (Button-Card `[[[...]]]` JS block/inline, card-mod CSS, entity patterns). `contributes.grammars` in `package.json` is the full list.
- `src/auth/` — Credential management via VS Code SecretStorage (token + HA URL)
- `src/status/` — Status bar showing HA connection state

## Build Commands

```bash
# Install deps (--ignore-scripts avoids native module EINVAL on utf-8-validate/bufferutil on Windows). Node 22 (.nvmrc)
npm install --ignore-scripts

npm run compile      # full build (see below)
npm run schema       # force schema regeneration (~35 s)
npm run watch        # esbuild watch (scripts/bundle.js --watch) — does NOT re-copy schemas
npm run lint         # ESLint (src/**/*.ts) + Prettier check (src/**/*.json) + type check
npm run format       # auto-fix
```

`compile` runs, in order:
1. `node scripts/build-theme.js` — theme from `src/parts/`
2. `ts-node src/language-service/src/schemas/generateSchemas.ts --quick` — writes `src/language-service/src/schemas/json/` (git-ignored); `--quick` only regenerates when a schema source is newer than the output
3. `tsc -p src/language-service/tsconfig.json` — copies that JSON into `src/language-service/dist/`
4. `tsc -p ./` — extension + server to `out/`
5. `node scripts/bundle.js` — esbuild bundles `out/extension.js` and `out/server/server.js`, then copies `mappings.json` + `json/` into `out/server/`. **`out/server/` is the copy `schemaService.ts` reads at runtime** (via `__dirname`).

**Important:** `generateSchemas.ts` must be run via `ts-node` (not `node dist/...`) — it resolves `.ts` sources from `__dirname`.

bundle.js externalises `vscode`, `bufferutil`, `utf-8-validate`; rewrites `vscode-json-languageservice/lib/umd/` imports to `lib/esm/`; and stubs Prettier, so yaml-language-server's formatter is a no-op. `vscode:prepublish` only bundles — run `compile` first.

Scripts in `scripts/*.js` are not linted. No `.prettierrc` (defaults). `.gitattributes` forces LF.

## Testing

- **`npm run test:unit`** (~4 s incl. compile) — plain mocha over `src/test/unit/` plus the `*-validation-mock` and workspace-detection suites. Use for the inner loop; put tests that don't need the `vscode` API in `src/test/unit/`.
- **`npm test`** (~1 min) — full suite inside a real extension host (`@vscode/test-electron`, workspace `./test-workspace/`; `test-ha-detection/` and `test-non-ha-detection/` are detection fixtures). Config `.vscode-test.js`. Most suites use mock connections — no live HA needed.
- `.vscode-test.js` strips `VSCODE_*`/`ELECTRON_*`/`HASS_*` etc. from the env so tests run from a VS Code-spawned shell don't attach to the running instance. Don't remove it.
- The husky pre-commit hook (`.husky/pre-commit`) runs the full `npm test`.

## Release

- Use the `release-extension` skill (`.claude/skills/vscode-release-extension/`). Bump `package.json` (`npm version x.y.z --no-git-tag-version --ignore-scripts`) **and** the root `version` file; add `## [x.y.z] - YYYY-MM-DD` to CHANGELOG (Keep a Changelog).
- `.\build.ps1 [-Install] [-SkipCompile]` packages the .vsix via vsce and checks that no `.claude/` / `.remember/` files leaked in. Anything not in `.vscodeignore` ships.
- Release commit messages end with `(x.y.z)`. Push to `main` (default branch since 2026-11-05).
- CI (`.github/workflows/github-actions-vscode-extension.yml`) is build + test on Ubuntu only — it does not publish. Releases are local `.vsix` builds.

## Architecture

### Two-Process Model

- **Extension host** (`src/extension.ts`): manages auth (SecretStorage), status bar, commands; spawns the language server via `LanguageClient`, passing credentials in `initializationOptions`.
- **Language server** (`src/server/server.ts`): all YAML intelligence — completions, validation, hover, go-to-definition. Custom requests/notifications between the two are defined in `server.ts`.

### Credential Flow

Resolved in order, each falling back to the next:
1. **VS Code SecretStorage** — keys `home-assistant.token` and `home-assistant.url` (`AuthManager`)
2. **Environment variables** — `HASS_TOKEN` / `SUPERVISOR_TOKEN` and `HASS_SERVER`
3. **Legacy settings.json** — `longLivedAccessToken` / `hostUrl`, auto-migrated to SecretStorage on startup and cleared

### AuthMiddleware

`src/auth/middleware.ts` monkey-patches the LanguageClient's private `client._connection` to inject token + URL into `ConfigurationRequest` responses and outgoing `DidChangeConfigurationNotification`s. On install it sends an initial notification, then a follow-up after 2 s for startup races. The `@ts-expect-error` on `client._connection` (in `src/extension.ts`) is intentional.

### Language Service (`src/language-service/`)

Self-contained sub-package with its own `package.json` and `tsconfig.json` (`outDir: dist`, `rootDir: src`).

- **`haLanguageService.ts`** — LSP entry points. Wraps `yaml-language-server`, applies schemas, registers HA custom tags, and delegates to:
  - `validation/referenceValidator.ts` — entity/area/device/floor/label/action and `!secret` checks against live HA data, built on `validation/referenceScanner.ts` (indent-aware key/value scanner)
  - `hover/hoverProvider.ts` — template rendering uses a 30 s in-memory cache keyed by template text
  - `schemas/circularRefs.ts` — limits circular `$ref` expansion
- **Schema findings** (`home-assistant-vscode.schemaValidation`, default on): diagnostics have source `yaml-schema: …`; YAML syntax errors (source `YAML`) are always shown. `generateSchemas.ts` resolves each mapping's `fromType` in the mapping's own file (type names like `File` collide). `schemaService.ts` registers each file under its discovered path, percent-encoded drive form and `realpath` — on a mapped network drive realpath returns a UNC path the editor never uses.
- **`home-assistant/`** — WebSocket connection (`haConnection.ts`, `socket.ts`, `home-assistant-js-websocket`); `registryCache.ts` holds event-refreshed registries with request timeouts.
- **`haConfig/`** — Parses the HA config dir and `!include` / `!include_dir_*`. Rediscovery on save is debounced (1 s) and only fires for root config files, `blueprints/`, or files containing `!include`.
- **`schemas/`** — TS types compiled to JSON Schema. `configuration.ts` is the root; `integrations/core/` one `.ts` per integration; `lovelace/` dashboards. `mappings.json` (source copy is the build input) maps schema keys/paths to types and output files.

### HA Workspace Detection

`isHomeAssistantWorkspace()` in `src/extension.ts` guards automatic YAML file-association so the extension doesn't hijack YAML in non-HA projects: `configuration.yaml`, then HA marker files (`.storage/`, `.HA_VERSION`, `automations.yaml`, …), then a `homeassistant:` top-level key.

## Pending Work (Fork Tracks)

- **Track 3** — Schema gaps (hand-edit the TS types, then `npm run schema`; history in the `ha-vscode-extension` skill):
  - 6 missing selectors in `selectors.ts`: `app`, `serial_port`, `statistic`, `numeric_threshold`, `choose`, `automation_behavior`
  - Template `LightItem` missing `color_temp_kelvin`, `min_color_temp_kelvin`, `max_color_temp_kelvin`
  - Legacy syntax on one trigger cascades into misleading "closest branch" errors (yaml-language-server `anyOf` reporting)
  - `hass-json-schema` / `jaseonline/home-assistant-json-schema` (archived) is downstream output of this repo's generator — not a source of schemas or fixes.
- **Track 4** — Lovelace dashboard editing of storage-mode dashboards via WebSocket (`lovelace/dashboards/list` / `lovelace/config` / `lovelace/config/save`), surfaced through a `ha-dashboard:` FileSystemProvider + QuickPick command. Scope: `docs/TRACK4-dashboard-editing.md`. Concept from `myakove/homeassistant-lsp`; reimplement against `haConnection.ts`, do not vendor.
