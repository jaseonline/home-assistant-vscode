# Change Log

All notable changes to the "home-assistant-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.1.18] - 2026-10-04

### Fixed

- Areas, devices, floors, labels and the entity registry now refresh when they change in Home Assistant (via `*_registry_updated` events), and open files are re-validated. Previously they were cached for the whole session, so re-added devices showed stale "does not exist" warnings until VS Code was restarted.
- A failed or unanswered registry request no longer stalls validation for the rest of the session: requests time out, failures are not cached, and the next call retries. The same applies to the initial entity and service load.
- One Home Assistant connection at startup instead of up to four: parallel callers share a single connection attempt, and configuration notifications that arrive mid-connect no longer force reconnects.
- Blueprint files under `blueprints/` are discovered again and get blueprint schema validation (root discovery had only been working through its fallback path).

### Changed

- Startup discovery lists the config root once and walks only the folders HA config can live in, using directory-entry types instead of a stat per file: 6.2 s → 0.45 s on a network-mounted config.
- Registry fetching is consolidated into a shared `RegistryCache`; area/floor names for entity hovers are read from the registries instead of parsed back out of completion text.
- `npm run test:unit` runs the VS Code-independent suites with plain mocha in about a second.
- Removed stray logs, the unused `.eslintrc.js`, `vsc-extension-quickstart.md` and the legacy `test:old` runner.

## [1.1.17] - 2026-10-04

### Fixed

- `Unresolved tag: !secret` (and other HA tags) errors while file discovery is still running. HA's custom tags are now registered when the language server starts instead of only after discovery and schema setup complete.
- Very slow (or never-finishing) startup discovery on large or network-mounted configs (SSHFS/SMB). Root discovery no longer walks `custom_components`, `www`, `node_modules`, `tts`, `deps` or `__pycache__` — a single icon-pack integration can add 20k+ files. `!include` / `!include_dir_*` resolution is unchanged.

## [1.1.16] - 2026-10-04

### Fixed

- Plain `device`, `area`, `floor` and `label` keys under an action's `data:` / `service_data:` are no longer validated as registry references. These names are reused as action parameters (e.g. Harmony `remote.send_command` `data.device: TV`). Plain keys are now only checked under `target`, `trigger(s)` and `condition(s)`; the `*_id` forms are still validated everywhere.

## [1.1.15] - 2026-10-04

### Fixed

- `Unresolved tag: !secret` (and `!include*`, `!input`, `!env_var`) errors on Home Assistant files when Red Hat YAML is installed. Red Hat YAML also validates the `home-assistant` language but did not know HA's custom tags; the extension now contributes a `yaml.customTags` default with the same tag list its own language server uses.

## [1.1.14] - 2026-10-04

### Fixed

- Label, area, device, floor, entity and action validation no longer report false "does not exist in your Home Assistant instance" warnings on dashboard YAML (button-card and similar custom cards):
  - keys must start the line, so `show_label: true` and `tap_action:` are no longer read as `label` / `action`;
  - block scalars (`|`, `>`) and `[[[ ... ]]]` templates are skipped;
  - list items are attributed only to their real (less-indented) parent key, so `styles.label:` no longer claims sibling CSS lists.
- Plain `label`, `area`, `device` and `floor` keys are only validated under `target`, `data`, `service_data`, `trigger(s)` or `condition(s)`; the `*_id` forms are validated everywhere.
- Inline flow mappings such as `target: { label_id: x }` are validated explicitly.

### Changed

- The six reference validators now share one indent-aware scanner (`validation/referenceScanner.ts`), removing ~1,100 lines of duplicated logic.

## Earlier versions

- Initial release