<img src="https://socialify.dev/jaseonline/home-assistant-vscode/image?description=1&font=Source+Code+Pro&forks=1&issues=1&language=1&logo=https%3A%2F%2Fmatilda.network%2Fimages%2Ficons%2Fhome-assistant-icon.svg&name=1&owner=1&pattern=Solid&pulls=1&stargazers=1&theme=Dark" alt="home-assistant-vscode" width="640" height="320" />
# Features

## Completion for Entity IDs, Actions, Scenes and Triggers

When connected with your Home Assistant server, entity IDs and actions will be auto-completed.

![entity_service_completion](./assets/entity_service_completion.gif)

## Completion & Validation for Configuration & Lovelace Schema

Most of the schemas of Home Assistant will be validated and things like properties, values and enums will be auto-completed. This extension understands the behaviour of Home Assistant '!include...' and uses this to provide scoped validation for all your files.

![schema_validation_completion](./assets/schema_validation_completion.gif)

Deprecation Warnings:

![deprecation-warnings](./assets/deprecation-warnings.png)

Schema Documentation

![schema-documentation](./assets/schema-documentation.png)

## Go to Definition for Includes

Easily navigate between your files references via the !include... tags using 'F12' / 'Go to Definition'.

![go_to_definition](./assets/go_to_definition.gif)

## Snippets

Snippets allow you to create commonly used data structures very quickly.

![snippet](./assets/snippet.gif)

## Commands

Commands allow you to quickly interact with Home Assistant! Find them using Cmd+Shift+P and type 'Home Assistant'

## Render templates

Evaluate jinja templates via Home Assistant's API and see how they would render.

![render-template](./assets/render-template.png)

## Standardised Palette

| Purpose | HEX |
| -- | -- |
| NEON BLUE | `#5fe8ff` |
| NEON GREEN | `#64ff00` |
| NEON YELLOW | `#e7ff00` |
| NEON PINK | `#fc49ab` |
| NEON ORANGE | `#ff7300` |
| Accent | #FB073A |
| Error | #F14C4C |
| Cyan | #00FFE7 |
| Blue | #00B4FF |
| Yellow | #FFE600 |
| Warning | #CCA700 |

# Getting started

1. Install via the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=keesschollaart.home-assistant-vscode)

2. Open your (local copy of the) Home Assistant Configuration with VS Code

3. Configure the connection to Home Assistant via the HA Section in the VS Code Settings UI

   More details in [the How-To in the Wiki](https://github.com/jaseonline/home-assistant-vscode/wiki/Configure-connection-to-HA)

4. Enjoy the features showcased below 👇

5. Continue reading in the Wiki:

   - [Configure connection to HA](https://github.com/jaseonline/home-assistant-vscode/wiki/Configure-connection-to-HA)
   - [VS Code Remote SSH](https://github.com/jaseonline/home-assistant-vscode/wiki/VS-Code-Remote-SSH)
   - [Your config, local or remote?](https://github.com/jaseonline/home-assistant-vscode/wiki/Your-config,-local-or-remote%3F)
   - [The troubleshooting guide](https://github.com/jaseonline/home-assistant-vscode/wiki/Troubleshooting)

