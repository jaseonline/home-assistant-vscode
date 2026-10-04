import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageService } from "yaml-language-server/out/server/src/languageservice/yamlLanguageService";
import { HomeAssistantLanguageService } from "../../language-service/src/haLanguageService";
import { HomeAssistantConfiguration } from "../../language-service/src/haConfig/haConfig";
import { SchemaServiceForIncludes } from "../../language-service/src/schemas/schemaService";
import { VsCodeFileAccessor } from "../../server/fileAccessor";

/**
 * Schemas are only applied to files reachable from configuration.yaml, so each
 * test builds a small on-disk config that !includes the file under test.
 * (The old VS Code-hosted versions wrote standalone files that no schema
 * applied to, and were hard-coded to pass.)
 */
async function schemaDiagnostics(
  files: Record<string, string>,
  target: string,
  beforeApply?: (dir: string) => void,
  schemaValidation = true,
): Promise<{ line: number; message: string; source: string }[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ha-schema-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const workspaceUri = pathToFileURL(dir).toString();
    const config = new HomeAssistantConfiguration(new VsCodeFileAccessor(workspaceUri, { get: (): undefined => undefined } as any));
    const offline = new Proxy({}, { get: (): (() => Promise<undefined>) => async () => undefined });
    const service = new HomeAssistantLanguageService(
      getLanguageService({ schemaRequestService: async () => "", workspaceContext: null as any, telemetry: undefined }),
      config,
      offline as any,
      [],
      await SchemaServiceForIncludes.create(),
      () => undefined,
      () => undefined,
      { isConfigured: true, schemaValidation } as any,
    );

    await config.discoverFiles();
    beforeApply?.(dir);
    await service.findAndApplySchemas();

    const uri = pathToFileURL(path.join(dir, target)).toString();
    const diagnostics = await service.getDiagnostics(TextDocument.create(uri, "home-assistant", 1, files[target]));
    // Only YAML/schema diagnostics; reference checks are covered elsewhere
    return diagnostics
      .filter((d) => d.source !== "home-assistant")
      .map((d) => ({ line: d.range.start.line, message: d.message, source: `${d.source}` }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const automations = (body: string) => ({
  "configuration.yaml": "automation: !include automations.yaml\n",
  "automations.yaml": body,
});

const scripts = (body: string) => ({
  "configuration.yaml": "script: !include scripts.yaml\n",
  "scripts.yaml": body,
});

suite("Schema validation (included files)", function () {
  this.timeout(20000);

  test("a valid automation has no schema errors", async () => {
    const found = await schemaDiagnostics(automations(`- id: valid_test_automation
  alias: Valid Test Automation
  triggers:
    - trigger: state
      entity_id: binary_sensor.motion
      to: "on"
  conditions:
    - condition: state
      entity_id: input_boolean.test_enabled
      state: "on"
  actions:
    - action: light.turn_on
      target:
        entity_id: light.living_room
      data:
        brightness: 255
`), "automations.yaml");

    assert.deepStrictEqual(found, []);
  });

  test("an unknown property in an automation action is reported", async () => {
    const found = await schemaDiagnostics(automations(`- id: a1
  alias: Unknown property
  triggers:
    - trigger: state
      entity_id: binary_sensor.motion
  actions:
    - action: light.turn_on
      unknown_property: something
`), "automations.yaml");

    assert.ok(
      found.some((d) => d.line === 7 && d.message.includes("unknown_property")),
      `expected an error on unknown_property, got ${JSON.stringify(found)}`,
    );
  });

  // Note: a *valid* scripts.yaml is not asserted clean - the bundled script
  // schema currently rejects every script key, which is why schema findings
  // are opt-in (home-assistant-vscode.schemaValidation, default off).
  test("a misspelled script key is reported", async () => {
    const valid = `valid_script:
  alias: Valid Script
  sequence:
    - action: light.turn_on
      target:
        entity_id: light.kitchen
`;
    const found = await schemaDiagnostics(scripts(`${valid}invalid_script:
  alias: Invalid Script
  sequenze:
    - action: light.turn_on
`), "scripts.yaml");
    assert.ok(found.length > 0, "expected the 'sequenze' typo to produce a schema error");
  });

  test("one unresolvable file does not disable schemas for the others", async () => {
    const found = await schemaDiagnostics(
      {
        "configuration.yaml": "script: !include scripts.yaml\nautomation: !include automations.yaml\n",
        "scripts.yaml": "s1:\n  sequenze: []\n",
        "automations.yaml": "[]\n",
      },
      "scripts.yaml",
      // Discovered, then gone before schemas are applied (e.g. deleted include)
      (dir) => fs.rmSync(path.join(dir, "automations.yaml")),
    );

    assert.ok(found.length > 0, "scripts.yaml should still get its schema");
  });

  test("schema findings are hidden when schemaValidation is off; syntax errors still show", async () => {
    const files = automations(`- id: a1
  alias: Unknown property
  triggers:
    - trigger: state
      entity_id: binary_sensor.motion
  actions:
    - action: light.turn_on
      unknown_property: something
`);
    assert.ok((await schemaDiagnostics(files, "automations.yaml")).length > 0, "on: schema finding reported");
    assert.deepStrictEqual(await schemaDiagnostics(files, "automations.yaml", undefined, false), [], "off: hidden");

    const broken = automations(`- id: a1
  alias: [unclosed
`);
    const found = await schemaDiagnostics(broken, "automations.yaml", undefined, false);
    assert.ok(found.length > 0 && found.every((d) => d.source === "YAML"), `syntax errors must remain: ${JSON.stringify(found)}`);
  });

  test("schemas match files on mapped drives, as VS Code addresses them", async () => {
    // A mapped network drive: realpath would turn this into a UNC path the
    // editor never uses, so the discovered and percent-encoded forms must match
    const service = await SchemaServiceForIncludes.create();
    const contributions = await service.getSchemaContributions([
      { filename: "h:\\homeassistant\\automations.yaml", path: "automations.yaml" },
    ]);
    const fileMatch: string[] = contributions.flatMap((c: any) => c.fileMatch ?? []);

    assert.ok(fileMatch.includes("h:/homeassistant/automations.yaml"), JSON.stringify(fileMatch));
    assert.ok(fileMatch.includes("h%3A/homeassistant/automations.yaml"), JSON.stringify(fileMatch));
  });
});
