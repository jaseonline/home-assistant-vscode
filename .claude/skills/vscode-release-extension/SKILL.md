---
name: release-extension
description: Release your home-assistant-vscode extension
---

Repo: jaseonline/home-assistant-vscode (default branch: `main`)
Local: D:\Projects\active\home-assistant-vscode

Release steps:
1. Bump the version with `npm version <x.y.z> --no-git-tag-version --ignore-scripts` (updates package.json and package-lock.json) and write the same value to the `version` file.
2. Add a `## [x.y.z] - YYYY-MM-DD` entry to CHANGELOG.md under `## [Unreleased]`.
3. Build and verify with `.\build.ps1 -Install` (compile → `vsce package --no-dependencies` → private-file leak check → install). If packaging fails, diagnose and fix it; check `.vscodeignore` if the file count jumps.
4. Developer: Reload Window and confirm `code --list-extensions --show-versions` shows the new version.
5. Commit, push, and merge to `main`.
6. Tag and push: `git tag fork-v<x.y.z> && git push origin fork-v<x.y.z>`. The `Release` workflow (`.github/workflows/release.yml`) checks the tag matches `package.json` and `version`, runs lint/compile/tests, packages the .vsix, and creates the GitHub Release with that version's CHANGELOG section as notes. Use the `fork-v` prefix — plain `v1.x`/`v2.x` tags are inherited from upstream and would collide.
7. Watch it: `gh run watch -R JaseOnline/home-assistant-vscode $(gh run list -R JaseOnline/home-assistant-vscode -w Release -L 1 --json databaseId -q '.[0].databaseId')`, then confirm `gh release view fork-v<x.y.z> -R JaseOnline/home-assistant-vscode` lists the .vsix.

Verify the build before reporting success.
