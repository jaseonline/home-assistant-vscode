<img src="https://socialify.dev/jaseonline/home-assistant-vscode/image?description=1&font=Source+Code+Pro&forks=1&issues=1&language=1&logo=https%3A%2F%2Fmatilda.network%2Fimages%2Ficons%2Fhome-assistant-icon.svg&name=1&owner=1&pattern=Solid&pulls=1&stargazers=1&theme=Dark" alt="home-assistant-vscode" width="640" height="320" />

# Home Assistant Config Helper (JaseOnline fork)

A personal fork of [keesschollaart81/vscode-home-assistant](https://github.com/keesschollaart81/vscode-home-assistant): completion, validation and navigation for Home Assistant YAML. The fork adds the **HA Neon Dark** theme, Button-Card and card-mod syntax highlighting, live reference validation, and credentials stored in VS Code SecretStorage.

The fork isn't published to the VS Code Marketplace. The Marketplace extension `keesschollaart.home-assistant-vscode` is the upstream version.

# Getting started

1. **Install** a `.vsix` built from this repo (see [Build from source](#build-from-source)):

   ```powershell
   code --install-extension home-assistant-vscode-<version>.vsix
   ```

2. **Open** your (local copy of the) Home Assistant configuration folder in VS Code. YAML files are associated automatically when the folder looks like an HA config. Turn that off with `home-assistant-vscode.disableAutomaticFileAssociation`.

3. **Connect** to Home Assistant: run **Home Assistant: Manage Home Assistant Authentication** from the Command Palette (`Ctrl+Shift+P`) and enter your instance URL and a [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile). Both are stored in VS Code SecretStorage, not in `settings.json`.

   - When running as an HA add-on, or with `HASS_SERVER` and `HASS_TOKEN` (or `SUPERVISOR_TOKEN`) set, the extension uses those.
   - Older `hostUrl` / `longLivedAccessToken` settings are migrated to SecretStorage automatically and then cleared.
   - The status bar shows the connection state; click it to manage authentication. **Test Home Assistant Connection** and **Debug Home Assistant Authentication** help when it won't connect.

4. More reading in the upstream wiki. The connection steps there describe the old settings-based setup:
   - [VS Code Remote SSH](https://github.com/keesschollaart81/vscode-home-assistant/wiki/VS-Code-Remote-SSH)
   - [Your config, local or remote?](https://github.com/keesschollaart81/vscode-home-assistant/wiki/Your-config,-local-or-remote%3F)
   - [Configure connection to HA](https://github.com/keesschollaart81/vscode-home-assistant/wiki/Configure-connection-to-HA)
   - [Troubleshooting](https://github.com/keesschollaart81/vscode-home-assistant/wiki/Troubleshooting)

# Features

## Completion for Entity IDs, Actions, Scenes and Triggers

When connected to your Home Assistant server, entity IDs, actions, areas, floors, labels, device IDs and `!secret` names are auto-completed.

![entity_service_completion](./assets/entity_service_completion.gif)

## Completion & Validation for Configuration & Lovelace Schema

Most Home Assistant schemas are validated, and properties, values and enums are auto-completed. The extension understands Home Assistant's `!include...` tags and uses them to give each file scoped validation.

- Unknown or misplaced keys are reported as warnings, legacy syntax (`platform:`, `service:`) as information, and YAML syntax errors as errors.
- Turn schema findings off with `home-assistant-vscode.schemaValidation`.

![schema_validation_completion](./assets/schema_validation_completion.gif)

Deprecation warnings:

![deprecation-warnings](./assets/deprecation-warnings.png)

Schema documentation:

![schema-documentation](./assets/schema-documentation.png)

## Live reference validation

References to entities, areas, devices, floors, labels and actions, and `!secret` names, are checked against your live Home Assistant registries. Missing ones are flagged as you type. The registries refresh automatically when they change in HA.

## Go to Definition for Includes

Navigate between files referenced by `!include...` tags, scripts and secrets with `F12` / **Go to Definition**.

![go_to_definition](./assets/go_to_definition.gif)

## Render templates

Evaluate Jinja templates through Home Assistant's API and see how they render. Use **Render Template**, or hover over a template (turn hover rendering off with `home-assistant-vscode.autoRenderTemplates`).

![render-templates](./assets/render-templates.png)

## Syntax highlighting

On top of the YAML and Jinja grammars:

- **Button-Card JavaScript**: `[[[ ... ]]]` blocks and inline templates are highlighted as JavaScript.
- **card-mod CSS**: CSS inside `card_mod:` blocks, including HA element selectors (`ha-*`, `hui-*`, `mwc-*`), custom properties and shadow-DOM `$:` keys.
- **Entity patterns**: entity IDs (domain and name coloured separately), service/action calls, and `custom:` card types.

## Snippets

Snippets let you create commonly used automation and script structures quickly.

![snippet](./assets/snippet.gif)

## Commands

Find them with `Ctrl+Shift+P` and type "Home Assistant":

- **Configuration:** check configuration (remote), reload core configuration, restart Home Assistant, reboot the Supervisor host.
- **Reloads:** reload all integrations, pick a specific integration (**Reload specific integration**), or use the individual reload commands (automations, scripts, scenes, templates, MQTT, and more).
- **Tools:** get error logs, render template, open Home Assistant in the browser.
- **Authentication:** manage, test, debug and repair the connection.

## Settings

| Setting | Default | What it does |
| -- | -- | -- |
| `home-assistant-vscode.schemaValidation` | `true` | Report schema findings (unknown keys, legacy syntax) as problems |
| `home-assistant-vscode.autoRenderTemplates` | `true` | Render templates on hover |
| `home-assistant-vscode.disableAutomaticFileAssociation` | `false` | Stop YAML files being associated with the Home Assistant language automatically |
| `home-assistant-vscode.ignoreCertificates` | `true` | Allow HTTPS connections with an invalid or self-signed certificate |

# HA Neon Dark theme

Select **HA Neon Dark** under **Preferences: Color Theme**. The theme is a neon-on-black palette tuned for Home Assistant YAML, Jinja, Button-Card JS and card-mod CSS.

The theme is generated from `src/parts/` by `scripts/build-theme.js`. `src/parts/palette.json` is the source of truth for the palette below. Each neon colour has a vivid complement (pair) and a dark hue-opposite (contrast) for backgrounds and highlights.

| Colour | Neon | Pair | Contrast |
| -- | -- | -- | -- |
| Red | `#FF3131` | `#00DDFF` | `#001A1A` |
| Orange | `#FF5C00` | `#0088FF` | `#001635` |
| Amber | `#FDFD3D` | `#9955FF` | `#060025` |
| Yellow | `#CCFF00` | `#BB44FF` | `#0D0030` |
| Green | `#39FF14` | `#CC44FF` | `#1A0040` |
| Mint | `#00FF9F` | `#FF0077` | `#1A0018` |
| Cyan | `#00FFFF` | `#FF3300` | `#1A0000` |
| Teal | `#5FE8FF` | `#FF5500` | `#1E0500` |
| Blue | `#1A7FFF` | `#FFAA00` | `#1C0E00` |
| Magenta | `#B026FF` | `#88FF00` | `#102000` |
| Pink | `#FF1493` | `#00FF66` | `#002211` |

| Text and surfaces | HEX |
| -- | -- |
| Body text | `#CFD8DC` |
| Bright text | `#E8E8F0` |
| Comments | `#737C75` |
| Off-white | `#FAFAFA` |
| Editor background | `#0F0F0F` |

# Build from source

Requires Node 22 (`.nvmrc`).

```powershell
npm install --ignore-scripts   # avoids native-module build errors on Windows
npm run compile                # theme, schemas, TypeScript, esbuild bundle
npm run test:unit              # fast unit tests; `npm test` runs the full suite in a VS Code host
.\build.ps1 -Install           # package home-assistant-vscode-<version>.vsix and install it
```

Then run **Developer: Reload Window**.

# Credits

Built on [vscode-home-assistant](https://github.com/keesschollaart81/vscode-home-assistant) by Kees Schollaart and contributors.
