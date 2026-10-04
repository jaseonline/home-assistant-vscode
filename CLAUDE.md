# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Fork Identity

This is a personal fork (`JaseOnline/home-assistant-vscode`) of `keesschollaart81/home-assistant-vscode`. Fork-specific additions live in:
- `src/themes/` — HA Neon Dark colour theme (embedded, replaces the standalone `ha-neon-dark` extension)
- `src/grammars/` — JS block/inline injection grammars for Button-Card `[[[...]]]` syntax
- `src/parts/` — Modular theme source components (hand-assembled into `src/themes/ha-neon-dark-color-theme.json`; no build script yet)
- `src/auth/` — Credential management via VS Code SecretStorage (token + HA URL)
- `src/status/` — Status bar showing HA connection state

## Build Commands

```bash
# Install deps (use --ignore-scripts on Node v24/Windows — avoids native module EINVAL on utf-8-validate/bufferutil)
npm install --ignore-scripts

# Full compile: language-service → schema generation → extension
npm run compile

# Schema generation only (force regeneration, no --quick flag)
npm run schema

# Watch mode for extension TypeScript only
npm run watch

# Lint (ESLint + Prettier check + type check)
npm run lint

# Auto-fix lint/formatting issues
npm run format

# Tests (compiles first, then runs inside a VS Code host process)
npm test
```

The `compile` script runs three steps in order:
1. `tsc -p src/language-service/tsconfig.json` — compiles language-service to `src/language-service/dist/`
2. `ts-node src/language-service/src/schemas/generateSchemas.ts --quick` — generates JSON schemas into `src/language-service/dist/schemas/json/` (skipped if files already exist)
3. `tsc -p ./` — compiles extension and server to `out/`

**Important:** `generateSchemas.ts` must be run via `ts-node` (not `node dist/...`). It uses `__dirname` to resolve `.ts` source files; running the compiled JS from `dist/` breaks this because the `.ts` files are only in `src/`.

## Testing

Two runners:

- **`npm run test:unit`** (~4 s incl. compile) — plain mocha over `src/test/unit/` plus the `*-validation-mock` and workspace-detection suites. Use this for the inner loop. Put new tests that don't need the `vscode` API in `src/test/unit/`.
- **`npm test`** (~1 min) — the full suite as VS Code integration tests inside a real extension host (`@vscode/test-electron`, workspace `./test-workspace/`). Includes the unit tests.

- Config: `.vscode-test.js` — `out/test/**/*.test.js`, TDD mocha, 20 s timeout, `--disable-extensions`
- Most tests in `src/test/suite/` use mock connections and do not require a live HA instance.
- `.vscode-test.js` strips `VSCODE_*`, `ELECTRON_*`, `CHROME_CRASHPAD_*`, `HASS_*` and `SUPERVISOR_*` from the environment. Without this, running `npm test` from a VS Code-spawned shell (integrated terminal, Claude Code) attaches the test instance to the running VS Code and it shuts down mid-suite with no mocha summary.

## Architecture

### Two-Process Model

The extension runs as two separate Node.js processes communicating over IPC:

- **Extension host** (`src/extension.ts` → `out/extension.js`): VS Code process. Manages auth (SecretStorage), status bar, commands, and spawns the language server.
- **Language server** (`src/server/server.ts` → `out/server/server.js`): Separate process. Handles all YAML intelligence — completions, validation, hover, go-to-definition. Uses `vscode-languageclient`/`vscode-languageserver`.

The extension host starts the language server via `LanguageClient`, passing credentials in `initializationOptions`. An `AuthMiddleware` intercepts LSP messages to inject the HA token and URL from SecretStorage into every configuration exchange.

### Credential Flow

Credentials (token + HA URL) are resolved at three layers, each falling back to the next:
1. **VS Code SecretStorage** — keys `home-assistant.token` and `home-assistant.url` (managed by `AuthManager`)
2. **Environment variables** — `HASS_TOKEN` / `SUPERVISOR_TOKEN` and `HASS_SERVER` (Supervisor sets these when running as an add-on)
3. **Legacy settings.json** — `longLivedAccessToken` and `hostUrl` (auto-migrated to SecretStorage on first use and cleared)

On startup, `AuthManager.migrateTokenFromSettings` and `migrateUrlFromSettings` run to move any settings-stored credentials into SecretStorage.

### IPC Surface Between Processes

The extension host and language server communicate beyond standard LSP via custom requests and notifications:

**Extension → Server (requests):**
- `callService` — triggers a HA service call (domain, service, optional serviceData)
- `checkConfig` — triggers HA config check
- `getErrorLog` — fetches HA error log
- `renderTemplate` — renders a Jinja2 template against HA

**Server → Extension (notifications):**
- `no-config` — credentials missing or incomplete
- `ha_connected` — WebSocket connected, carries `{ name, version }`
- `ha_connection_error` — WebSocket failed, carries `{ error }`
- `configuration_check_completed` — result of `checkConfig`
- `get_error_log_completed` — result of `getErrorLog`
- `render_template_completed` — rendered template string

### AuthMiddleware

`src/auth/middleware.ts` monkey-patches the LanguageClient's private connection (`client._connection`) to intercept:
- `ConfigurationRequest` — injects token and URL into every config response before it reaches the server
- `DidChangeConfigurationNotification` — injects token and URL into outgoing config update notifications

On install it immediately sends an initial `DidChangeConfigurationNotification` with full credentials, then a follow-up after 2 s to handle race conditions during server startup. The `@ts-expect-error` on `client._connection` is intentional — the connection is private in `vscode-languageclient` but must be accessed directly for middleware installation.

### Language Service (`src/language-service/`)

Self-contained sub-package with its own `tsconfig.json` (`outDir: dist`, `rootDir: src`). Provides:

- **`haLanguageService.ts`** — LSP entry points (diagnostics, completion, hover, definition, formatting). Wraps `yaml-language-server`, applies schemas, registers HA custom tags at construction, and delegates to:
  - `validation/referenceValidator.ts` — entity/area/device/floor/label/action and `!secret` checks against live HA data, built on `validation/referenceScanner.ts` (indent-aware YAML key/value scanner)
  - `hover/hoverProvider.ts` — schema, entity, action and template hovers; template rendering uses a 30 s in-memory cache keyed by template text
  - `schemas/circularRefs.ts` — limits circular `$ref` expansion before schemas reach the YAML service
- **Schema findings are opt-in** (`home-assistant-vscode.schemaValidation`, default off): the bundled schemas lag current HA syntax and report false errors (e.g. every key in `scripts.yaml`). Schema diagnostics have source `yaml-schema: …`; YAML syntax errors (source `YAML`) are always shown. `schemaService.ts` registers each file under its discovered path, its percent-encoded drive form and its `realpath` — on a mapped network drive realpath returns a UNC path the editor never uses.
- **`home-assistant/registryCache.ts`** — cached, event-refreshed HA registries (areas, devices, floors, labels, entity registry) with request timeouts; used by `haConnection.ts`.
- **`completionHelpers/`** — One file per completion type: entity IDs, services, areas, floors, labels, device IDs, secrets, UUIDs.
- **`haConfig/`** — Parses the HA config directory, resolves `!include` / `!include_dir_*` YAML tags. File rediscovery on save is debounced (1 s) and only fires for root config files, files in `blueprints/`, or files containing `!include` directives — not on every save.
- **`home-assistant/`** — WebSocket connection to HA (`haConnection.ts`, `socket.ts`) using `home-assistant-js-websocket`. Exposes `onConnectionEstablished` and `onConnectionFailed` callbacks used by the server to notify the extension host.
- **`schemas/`** — TypeScript type definitions compiled to JSON Schema at build time. `configuration.ts` is the root; `integrations/core/` has one `.ts` per integration; `lovelace/` covers dashboard schemas. `generateSchemas.ts` uses `typescript-json-schema` to emit `dist/schemas/json/*.json`, which are loaded at runtime by `schemaService.ts`.
- **`definition/`** — Go-to-definition providers for `!include` tags, script references, and secrets.
- **`configuration.ts`** — `ConfigurationService` receives `DidChangeConfigurationParams` from the server's `onDidChangeConfiguration` handler and applies the resolved token/URL. It also reads env vars directly as a fallback.

### HA Workspace Detection

`isHomeAssistantWorkspace()` in `src/extension.ts` guards automatic YAML file-association. It looks for `configuration.yaml` first, then checks for `.storage/`, `home-assistant_v2.db`, `home-assistant.log`, `.HA_VERSION`, `automations.yaml`, `scripts.yaml`, `scenes.yaml`, or `ui-lovelace.yaml`. If none found, it reads `configuration.yaml` and checks for a `homeassistant:` top-level key. This prevents the extension from hijacking YAML in non-HA projects.

### Grammar / Syntax Highlighting

- `syntaxes/external/YAML.tmLanguage` — Base YAML grammar, scope `source.home-assistant`
- `syntaxes/home-assistant/jinja-*.tmLanguage` — Jinja injection grammars injected into `source.home-assistant`
- `src/grammars/js-block.tmLanguage.json` — Injects JS highlighting into Button-Card `[[[...]]]` blocks
- `src/grammars/js-inline.tmLanguage.json` — Inline variant

### Schema Pipeline

TypeScript interfaces in `src/language-service/src/schemas/` → `typescript-json-schema` (TJS) → JSON files in `src/language-service/dist/schemas/json/`. The mapping between schema keys, paths, TS types, and output files is `src/language-service/dist/schemas/mappings.json` (the dist copy is authoritative at runtime; the source copy is the build input).

## Known Validators / False Positives

The label validator flags `Reload`, `Lighting`, `Music` as unknown — these are valid HA labels. The area validator flags `ssid`, `pwd`, `qr` — these are valid area names in Jason's HA config. These are known false positives; do not suppress them by altering schema types.

## Pending Work (Fork Tracks)

- **Track 3** — Evaluate `jaseonline/home-assistant-json-schema` repo (`C:\Dev\projects\personal\home-assistant-json-schema`) for automated schema generation to replace hand-written `.ts` files in `src/language-service/src/schemas/integrations/core/`. High effort; separate sub-project.
- **Track 4** — Lovelace dashboard editing: edit storage-mode dashboards from VS Code via WebSocket (`lovelace/dashboards/list` / `lovelace/config` / `lovelace/config/save`), surfaced through a `ha-dashboard:` FileSystemProvider + QuickPick command. Full scope: `docs/TRACK4-dashboard-editing.md`. Concept ported from `myakove/homeassistant-lsp`; reimplement against `haConnection.ts`, do not vendor.
- **Optional** — Build script to assemble `src/parts/*.json` into `src/themes/ha-neon-dark-color-theme.json` (currently hand-maintained).
