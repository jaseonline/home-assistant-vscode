import { resolve } from "path";
import * as TJS from "typescript-json-schema";
import * as fs from "fs";
import * as path from "path";
import { PathToSchemaMapping } from "./schemaService";
import { exit } from "process";

const settings: TJS.PartialArgs = {
  required: true,
  noExtraProps: true,
  // Passed through to the schema; yaml-language-server shows it instead of
  // the raw regex when a pattern fails (used by Deprecated / LegacySyntax)
  validationKeywords: ["patternErrorMessage"],
};

const compilerOptions: TJS.CompilerOptions = {
  strictNullChecks: true,
};

/**
 * Generate the schema for `mapping.fromType` as declared in `mapping.tsFile`.
 *
 * Type names are not unique: 23 mappings use a type called `File`, and many
 * integration modules declare one. TJS.generateSchema(program, "File") picks
 * whichever `File` it meets first in the program (which includes imported
 * modules), so e.g. the script, sensor and light schemas were generated from
 * automation.ts's `File`. With uniqueNames each symbol is addressable, and we
 * take the one declared in the mapping's own file.
 */
function generateSchemaFromOwnFile(
  program: TJS.Program,
  mapping: PathToSchemaMapping,
): TJS.Definition | null {
  const generator = TJS.buildGenerator(program, { ...settings, uniqueNames: true });
  if (!generator) {
    return null;
  }
  const modulePath = path
    .normalize(mapping.tsFile)
    .replace(/\.ts$/, "")
    .split(path.sep)
    .join("/");
  const candidates = generator.getSymbols(mapping.fromType);
  // An unambiguous name needs no disambiguation; otherwise fullyQualifiedName
  // looks like: "<abs path>/integrations/core/script".File
  const own =
    candidates.length === 1
      ? candidates[0]
      : candidates.find((s) => s.fullyQualifiedName.includes(`/${modulePath}".`));
  if (!own) {
    console.error(
      `No '${mapping.fromType}' declared in ${mapping.tsFile} (found: ${candidates.map((c) => c.fullyQualifiedName).join(", ") || "none"})`,
    );
    return null;
  }
  return generator.getSchemaForSymbol(own.name);
}

const jsonPath = path.join(__dirname, "mappings.json");
const filecontents = fs.readFileSync(jsonPath, "utf-8");

const outputFolder = path.join(__dirname, "json");

if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder);
}

/** Newest modification time of the schema sources (TypeScript, mappings, this generator). */
function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "json") {
        newest = Math.max(newest, newestSourceMtime(full));
      }
    } else if (/\.(ts|json)$/.test(entry.name)) {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  return newest;
}

/** --quick: skip only when every generated file is newer than all schema sources. */
function generatedSchemasAreCurrent(): boolean {
  const generated = fs.readdirSync(outputFolder).filter((f) => f.endsWith(".json"));
  if (generated.length === 0) {
    return false;
  }
  const oldestGenerated = Math.min(...generated.map((f) => fs.statSync(path.join(outputFolder, f)).mtimeMs));
  return oldestGenerated >= newestSourceMtime(__dirname);
}

if (process.argv[2] === "--quick" && generatedSchemasAreCurrent()) {
  console.debug(
    "Skipping schema generation: generated schemas are newer than their sources",
  );
} else {
  console.log("Generating schemas...");
  const pathToSchemaMappings: PathToSchemaMapping[] = JSON.parse(filecontents);
  pathToSchemaMappings.forEach((mapping) => {
    console.log(mapping.path);
    const program = TJS.getProgramFromFiles(
      [resolve(path.join(__dirname, mapping.tsFile))],
      compilerOptions,
    );
    const schema = generateSchemaFromOwnFile(program, mapping);
    if (schema === null) {
      console.error("Schema generation failed");
      exit(1);
    }
    fs.writeFileSync(
      path.join(outputFolder, mapping.file),
      JSON.stringify(schema),
    );
  });
}
