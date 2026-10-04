// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

// Run the test instance in a clean environment:
// - VSCODE_*/ELECTRON_*/crashpad vars leak in when tests are started from a
//   shell spawned by VS Code (integrated terminal, Claude Code). With the same
//   VS Code version installed, the test instance attaches to the running
//   instance's IPC pipe and gets shut down part-way through the suite
//   (extension host "exited with code: 0", no mocha summary).
// - HASS_*/SUPERVISOR_* would make the extension connect to a real Home
//   Assistant (env vars are its credential fallback); tests use mocks.
for (const key of Object.keys(process.env)) {
  if (/^(VSCODE_|ELECTRON_|CHROME_CRASHPAD_|HASS_|SUPERVISOR_)/i.test(key)) {
    delete process.env[key];
  }
}

module.exports = defineConfig({
  label: 'Home Assistant Extension Tests',
  files: 'out/test/**/*.test.js',
  workspaceFolder: './test-workspace',
  mocha: {
    ui: 'tdd',
    timeout: 20000,
    color: true
  },
  // Use stable version of VS Code
  version: 'stable',
  // Use Insiders version for development (uncomment to use Insiders)
  // version: 'insiders',
  // Disable all other extensions during tests
  launchArgs: ['--disable-extensions']
});
