# Change Log

All notable changes to the "home-assistant-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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