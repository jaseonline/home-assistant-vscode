import * as path from "path";
import * as fs from "fs/promises";
import { JSONSchema } from "yaml-language-server/out/server/src/languageservice/jsonSchema";
import { HaFileInfo } from "../haConfig/dto";

export class SchemaServiceForIncludes {
  private mappings: (PathToSchemaMapping & { schema: JSONSchema })[];

  private constructor() {
    this.mappings = [];
  }

  public static async create(): Promise<SchemaServiceForIncludes> {
    const instance = new SchemaServiceForIncludes();
    await instance.initialize();
    return instance;
  }

  private async initialize(): Promise<void> {
    const jsonPathMappings = path.join(__dirname, "mappings.json");
    const mappingFileContents = await fs.readFile(jsonPathMappings, "utf-8");
    this.mappings = JSON.parse(mappingFileContents);
    for (const mapping of this.mappings) {
      const jsonPath = path.join(__dirname, "json", mapping.file);
      const filecontents = await fs.readFile(jsonPath, "utf-8");
      const schema = JSON.parse(filecontents) as JSONSchema;
      mapping.schema = schema;
    };
  }

  public async getSchemaContributions(haFiles: HaFileInfo[]): Promise<any> {
    const results: {
      uri: string;
      fileMatch?: string[];
      schema?: JSONSchema;
    }[] = [];

    for (const [sourceFile, sourceFileMapping] of haFiles.entries()) {
      let sourceFileMappingPath = sourceFileMapping.path.replace(
        path.join("homeassistant", "packages") + path.sep,
        "",
      );
      sourceFileMappingPath = sourceFileMappingPath.replace(
        /cards(\/|\\)cards/g,
        "cards",
      );

      if (
        sourceFileMappingPath.startsWith(
          path.join("blueprints", "automation") + path.sep,
        )
      ) {
        sourceFileMappingPath = "blueprints/automation";
      }

      if (
        sourceFileMappingPath.startsWith(
          path.join("blueprints", "script") + path.sep,
        )
      ) {
        sourceFileMappingPath = "blueprints/script";
      }

      if (
        sourceFileMappingPath.startsWith(
          path.join("blueprints", "template") + path.sep,
        )
      ) {
        sourceFileMappingPath = "blueprints/template";
      }

      if (
        sourceFileMappingPath.startsWith("automations" + path.sep) ||
        sourceFileMappingPath === "automations.yaml"
      ) {
        sourceFileMappingPath = "configuration.yaml/automation";
      }

      if (
        sourceFileMappingPath.startsWith("groups" + path.sep) ||
        sourceFileMappingPath === "groups.yaml"
      ) {
        sourceFileMappingPath = "configuration.yaml/group";
      }

      if (sourceFileMappingPath.startsWith("custom_sentences" + path.sep)) {
        sourceFileMappingPath = "custom_sentences.yaml";
      }

      const relatedPathToSchemaMapping = this.mappings.find(
        (x) => x.path === sourceFileMappingPath,
      );
      if (relatedPathToSchemaMapping) {
        const id = `http://schemas.home-assistant.io/${relatedPathToSchemaMapping.key}`;
        // Match the file both as discovered and as resolved by realpath. The
        // editor opens files by the discovered path; realpath can rewrite it,
        // e.g. a mapped network drive (H:\ over SSHFS/SMB) becomes a UNC path
        // (\\server\share\...) the editor's URI never matches, which silently
        // left every file on such a drive without a schema.
        const discoveredPath = haFiles[sourceFile].filename;
        let resolvedPath = discoveredPath;
        try {
          resolvedPath = await fs.realpath(discoveredPath);
        } catch (error) {
          // One unresolvable file (e.g. an !include of a deleted file) must
          // not abort schema assignment for every other file
          console.log(`Could not resolve ${discoveredPath}, using it as-is:`, error);
        }
        const fileMatches = [...new Set([discoveredPath, resolvedPath])].flatMap((p) => {
          const asUriPath = encodeURI(p.replace(/\\/g, "/"));
          // VS Code sends Windows drive letters percent-encoded (file:///h%3A/...)
          const encodedDrive = asUriPath.replace(/^([a-zA-Z]):/, "$1%3A");
          return encodedDrive === asUriPath ? [asUriPath] : [asUriPath, encodedDrive];
        });
        let resultEntry = results.find((x) => x.uri === id);

        console.log(
          `Assigning ${fileMatches.join(" / ")} the ${relatedPathToSchemaMapping.path} schema`,
        );

        if (!resultEntry) {
          resultEntry = {
            uri: id,
            fileMatch: [...fileMatches],
            schema: relatedPathToSchemaMapping.schema,
          };
          results.push(resultEntry);
        } else if (resultEntry.fileMatch !== undefined) {
          resultEntry.fileMatch.push(...fileMatches);
        }
      }
    }
    return results;
  }
}

export interface PathToSchemaMapping {
  key: string;
  path: string;
  file: string;
  tsFile: string;
  fromType: string;
}
