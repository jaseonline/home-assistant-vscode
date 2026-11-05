# Security Policy

## Supported Versions

This is a personal fork, released as `.vsix` builds from `main`. Only the latest release gets security fixes.

| Version | Supported |
| ------- | --------- |
| Latest 1.1.x (currently 1.1.20) | :white_check_mark: |
| Older releases | :x: |

## Reporting a Vulnerability

Please **don't** open a public issue. Report it privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/JaseOnline/home-assistant-vscode/security) of this repository.
2. Click **Report a vulnerability** ([direct link](https://github.com/JaseOnline/home-assistant-vscode/security/advisories/new)).
3. Include the affected version, steps to reproduce, and the impact you see.

This is maintained in spare time, so responses are best effort. I aim to acknowledge a report and to keep you updated in the advisory thread until it's fixed or declined. Accepted issues are fixed in a new release and disclosed through a GitHub security advisory, with credit if you'd like it.

## Scope

In scope:

- Handling of the Home Assistant URL and long-lived access token (VS Code SecretStorage, environment variables, migration from `settings.json`)
- The extension's connection to Home Assistant (WebSocket and REST calls, certificate handling)
- Anything in the extension that could run code or leak data from a workspace

Out of scope:

- Vulnerabilities in Home Assistant itself. Report those to the [Home Assistant project](https://www.home-assistant.io/security/).
- Issues that also affect the upstream extension. Report those to [keesschollaart81/vscode-home-assistant](https://github.com/keesschollaart81/vscode-home-assistant) as well.
- `home-assistant-vscode.ignoreCertificates` accepting invalid certificates. That is its documented purpose; turn it off to require valid certificates.
