---
name: release-extension
description: Release your home-assistant-vscode extension
---

Repo: jaseonline/home-assistant-vscode (default branch: `master`)
Local: D:\Projects\active\home-assistant-vscode

Release steps:
1. Bump the version with `npm version <x.y.z> --no-git-tag-version --ignore-scripts` (updates package.json and package-lock.json) and write the same value to the `version` file.
2. Add a `## [x.y.z] - YYYY-MM-DD` entry to CHANGELOG.md under `## [Unreleased]`.
3. Build and verify with `.\build.ps1 -Install` (compile → `vsce package --no-dependencies` → private-file leak check → install). If packaging fails, diagnose and fix it; check `.vscodeignore` if the file count jumps.
4. Developer: Reload Window and confirm `code --list-extensions --show-versions` shows the new version.
5. Commit, push, and merge to `master`.

Verify the build before reporting success.
