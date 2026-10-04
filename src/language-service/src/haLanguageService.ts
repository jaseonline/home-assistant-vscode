import {
  CompletionItem,
  CompletionList,
  Definition,
  DefinitionLink,
  Diagnostic,
  FormattingOptions,
  Hover,
  Position,
  Range,
  SymbolInformation,
  TextDocument,
  TextEdit,
  CompletionItemKind,
} from "vscode-languageserver-protocol";
import { getLineOffsets } from "yaml-language-server/out/server/src/languageservice/utils/arrUtils";
import {
  LanguageService,
  LanguageSettings,
} from "yaml-language-server/out/server/src/languageservice/yamlLanguageService";
import { SchemaServiceForIncludes } from "./schemas/schemaService";
import { AreaCompletionContribution } from "./completionHelpers/areas";
import { EntityIdCompletionContribution } from "./completionHelpers/entityIds";
import { FloorCompletionContribution } from "./completionHelpers/floors";
import { LabelCompletionContribution } from "./completionHelpers/labels";
import { HaConnection } from "./home-assistant/haConnection";
import { ServicesCompletionContribution } from "./completionHelpers/services";
import { DomainCompletionContribution } from "./completionHelpers/domains";
import { UuidCompletionContribution } from "./completionHelpers/uuids";
import { SecretsCompletionContribution } from "./completionHelpers/secrets";
import { DefinitionProvider } from "./definition/definition";
import { HomeAssistantConfiguration } from "./haConfig/haConfig";
import { Includetype } from "./haConfig/dto";
import { IConfigurationService } from "./configuration";
import { ReferenceValidator } from "./validation/referenceValidator";
import { HoverProvider } from "./hover/hoverProvider";
import { fixCircularRefsInSchema } from "./schemas/circularRefs";

export class HomeAssistantLanguageService {
  private readonly referenceValidator: ReferenceValidator;

  private readonly hoverProvider: HoverProvider;

  constructor(
    private yamlLanguageService: LanguageService,
    private haConfig: HomeAssistantConfiguration,
    private haConnection: HaConnection,
    private definitionProviders: DefinitionProvider[],
    private schemaServiceForIncludes: SchemaServiceForIncludes,
    private sendDiagnostics: (
      fileUri: string,
      diagnostics: Diagnostic[],
    ) => void,
    private diagnoseAllFiles: () => void,
    private configurationService: IConfigurationService,
  ) {
    this.referenceValidator = new ReferenceValidator(this.haConnection, this.haConfig);
    this.hoverProvider = new HoverProvider(this.yamlLanguageService, this.haConnection, this.configurationService);

    // Register HA's custom tags immediately. findAndApplySchemas() re-configures
    // with schemas once file discovery finishes, but that can take a long time on
    // network mounts; until then every !secret / !include would be reported as
    // "Unresolved tag".
    this.yamlLanguageService.configure({
      validate: true,
      customTags: this.getValidYamlTags(),
      completion: true,
      format: true,
      hover: true,
      isKubernetes: false,
      schemas: [],
    } as LanguageSettings);
  }

  public findAndApplySchemas = async (): Promise<void> => {
    try {
      const haFiles = this.haConfig.getAllFiles();
      if (haFiles && haFiles.length > 0) {
        console.log(
          `Applying schemas to ${haFiles.length} of your configuration files...`,
        );
      }

      // Get schemas and fix circular references before applying
      const schemas = await this.schemaServiceForIncludes.getSchemaContributions(haFiles);
      const fixedSchemas = schemas.map((schemaContribution: any) => ({
        ...schemaContribution,
        schema: schemaContribution.schema ? fixCircularRefsInSchema(schemaContribution.schema) : schemaContribution.schema,
      }));

      this.yamlLanguageService.configure({
        validate: true,
        customTags: this.getValidYamlTags(),
        completion: true,
        format: true,
        hover: true,
        isKubernetes: false,
        schemas: fixedSchemas,
      } as LanguageSettings);

      this.diagnoseAllFiles();
    } catch (error) {
      const message: string = error.message;
      console.error(
        `Unexpected error updating the schemas, message: ${message}`,
        error,
      );
    }
    console.log("Schemas updated!");
  };

  private getValidYamlTags(): string[] {
    const validTags: string[] = [];
    for (const item in Includetype) {
      if (Number.isNaN(Number(item))) {
        validTags.push(`!${item} scalar`);
      }
    }
    validTags.push("!env_var scalar");
    validTags.push("!input scalar");
    validTags.push("!secret scalar");

    return validTags;
  }

  private onDocumentChangeDebounce: NodeJS.Timeout | undefined;

  public onDocumentChange = (document: TextDocument): void => {
    if (this.onDocumentChangeDebounce !== undefined) {
      clearTimeout(this.onDocumentChangeDebounce);
    }

    this.onDocumentChangeDebounce = setTimeout(async (): Promise<void> => {
      const singleFileUpdate = await this.haConfig.updateFile(document.uri);
      if (singleFileUpdate.isValidYaml && singleFileUpdate.newFilesFound) {
        console.log(
          `Discover all configuration files because ${document.uri} got updated and new files were found...`,
        );
        await this.haConfig.discoverFiles();
        await this.findAndApplySchemas();
      }

      const diagnostics = await this.getDiagnostics(document);

      this.sendDiagnostics(document.uri, diagnostics);
    }, 600);
  };

  public onDocumentOpen = async (document: TextDocument): Promise<void> => {
    const diagnostics = await this.getDiagnostics(document);

    this.sendDiagnostics(document.uri, diagnostics);
  };

  public getDiagnostics = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    if (!document || document.getText().length === 0) {
      return [];
    }

    const diagnosticResults = await this.yamlLanguageService.doValidation(
      document,
      false,
    );

    if (!diagnosticResults) {
      return [];
    }
    const diagnostics: Diagnostic[] = [];
    for (const diagnosticItem of diagnosticResults) {
      const startChar = diagnosticItem.range.start.character;
      const startLine = diagnosticItem.range.start.line;
      const endLine = diagnosticItem.range.end.line;
      
      // Fetch the text before the error, this might be "!secret"
      // Ensure we don't go negative with character positions
      const secretStartChar = Math.max(0, startChar - 8);
      const secretEndChar = Math.max(0, startChar - 1);
      
      if (secretStartChar < secretEndChar) {
        const possibleSecret = document.getText(
          Range.create(
            startLine,
            secretStartChar,
            endLine,
            secretEndChar,
          ),
        );

        // Skip errors about secrets, we simply have no idea what is in them
        if (possibleSecret === "!secret") {
          continue;
        }
      }

      // Fetch the text before the error, this might be "!input"
      const inputStartChar = Math.max(0, startChar - 7);
      const inputEndChar = Math.max(0, startChar - 1);
      
      if (inputStartChar < inputEndChar) {
        const possibleInput = document.getText(
          Range.create(
            startLine,
            inputStartChar,
            endLine,
            inputEndChar,
          ),
        );

        // Skip errors about input, that is up to the Blueprint creator
        if (possibleInput === "!input") {
          continue;
        }
      }

      // Fetch the text before the error, this might be "!include"
      const includeStartChar = Math.max(0, startChar - 9);
      const includeEndChar = Math.max(0, startChar - 1);
      
      if (includeStartChar < includeEndChar) {
        const possibleInclude = document.getText(
          Range.create(
            startLine,
            includeStartChar,
            endLine,
            includeEndChar,
          ),
        );

        // Skip errors about include, everything can be included
        if (possibleInclude === "!include") {
          continue;
        }
      }

      // Schema findings are opt-in (home-assistant-vscode.schemaValidation);
      // YAML syntax errors (source "YAML") are always reported
      const isSchemaFinding = `${diagnosticItem.source}`.startsWith("yaml-schema");
      if (isSchemaFinding && !this.configurationService.schemaValidation) {
        continue;
      }

      if (!isSchemaFinding) {
        diagnosticItem.severity = 1; // YAML syntax problems are errors
      } else if (diagnosticItem.message.startsWith("Legacy syntax")) {
        diagnosticItem.severity = 3; // Information: still accepted by Home Assistant
      } else {
        diagnosticItem.severity = 2; // Warning: the schemas can lag behind Home Assistant
      }
      diagnostics.push(diagnosticItem);
    }

    diagnostics.push(...(await this.referenceValidator.validate(document)));

    return diagnostics;
  };

  public onDocumentSymbol = (document: TextDocument): SymbolInformation[] => {
    if (!document) {
      return [];
    }

    return this.yamlLanguageService.findDocumentSymbols(document, {});
  };

  public onDocumentFormatting = async (
    document: TextDocument,
    options: FormattingOptions,
  ): Promise<TextEdit[]> => {
    if (!document) {
      return [];
    }

    // copied defaults from YAML Language Service
    const settings = {
      tabWidth: options.tabSize,
      singleQuote: false,
      bracketSpacing: true,
      proseWrap: "preserve",
      printWidth: 80,
      enable: true,
    };

    return await this.yamlLanguageService.doFormat(document, settings);
  };

  public onCompletion = async (
    textDocument: TextDocument,
    position: Position,
  ): Promise<CompletionList> => {
    const result: CompletionList = {
      items: [],
      isIncomplete: false,
    };

    if (!textDocument) {
      return Promise.resolve(result);
    }

    const currentCompletions: CompletionList =
      await this.yamlLanguageService.doComplete(textDocument, position, false);

    const additionalCompletions = await this.getServiceAndEntityCompletions(
      textDocument,
      position,
      currentCompletions,
    );

    if (additionalCompletions.length === 0) {
      return currentCompletions;
    }

    return CompletionList.create(additionalCompletions, false);
  };

  public onCompletionResolve = async (
    completionItem: CompletionItem,
  ): Promise<CompletionItem> => {
    // Lazy-load entity documentation on-demand to avoid performance issues
    // when there are hundreds/thousands of entities
    if (completionItem.data?.isEntity && completionItem.data?.entityId) {
      const documentation = await this.haConnection.resolveEntityCompletionDocumentation(
        completionItem.data.entityId
      );
      if (documentation) {
        completionItem.documentation = documentation;
      }
    }
    return completionItem;
  };

  public onHover = (document: TextDocument, position: Position): Promise<Hover | null> =>
    this.hoverProvider.onHover(document, position);

  public onDefinition = async (
    textDocument: TextDocument,
    position: Position,
  ): Promise<Definition | DefinitionLink[] | undefined> => {
    if (!textDocument) {
      return undefined;
    }
    const lineOffsets: number[] = getLineOffsets(textDocument.getText());
    const start: number = lineOffsets[position.line];
    const end: number = lineOffsets[position.line + 1];
    const thisLine = textDocument.getText().substring(start, end);

    let results = [];
    for (const provider of this.definitionProviders) {
      results.push(provider.onDefinition(thisLine, textDocument.uri));
    }
    results = await Promise.all(results);

    let definitions: any = [];
    for (const result of results) {
      if (result) {
        definitions = definitions.concat(result);
      }
    }

    return definitions;
  };

  private getSecretsCompletion = async (
    document: TextDocument,
    textDocumentPosition: Position,
  ): Promise<CompletionItem[]> => {
    const lineOffsets: number[] = getLineOffsets(document.getText());
    const start: number = lineOffsets[textDocumentPosition.line];
    const currentLineText = document.getText().substring(start, start + textDocumentPosition.character);
    
    // Check if the current line contains !secret followed by a space
    const secretMatch = currentLineText.match(/.*!secret\s+(\w*)$/);
    if (!secretMatch) {
      return [];
    }

    // We're positioned after !secret, provide secret completions
    const fileAccessor = this.haConfig.getFileAccessor();
    const secretsHelper = new SecretsCompletionContribution(fileAccessor);
    
    try {
      return await secretsHelper.getSecretsCompletions();
    } catch (error) {
      console.log("Error getting secrets completions:", error);
      return [];
    }
  };

  private getServiceAndEntityCompletions = async (
    document: TextDocument,
    textDocumentPosition: Position,
    currentCompletions: CompletionList,
  ): Promise<CompletionItem[]> => {
    // sadly this is needed here.
    // the normal completion engine cannot provide completions for type `string | string[]`
    // updating the type to only one of the 2 types will break the yaml-validation.
    // so we tap in here, iterate over the lines of the text file to see if this if
    // we need to add entity_id's to the completion list

    // First check if we're after a !secret tag
    const secretsCompletion = await this.getSecretsCompletion(document, textDocumentPosition);
    if (secretsCompletion.length > 0) {
      return secretsCompletion;
    }

    const properties: { [provider: string]: string[] } = {};
    properties.areas = AreaCompletionContribution.propertyMatches;
    properties.entities = EntityIdCompletionContribution.propertyMatches;
    properties.floors = FloorCompletionContribution.propertyMatches;
    properties.labels = LabelCompletionContribution.propertyMatches;
    properties.services = ServicesCompletionContribution.propertyMatches;
    properties.domains = DomainCompletionContribution.propertyMatches;
    properties.uuids = UuidCompletionContribution.propertyMatches;
    properties.uuids = UuidCompletionContribution.propertyMatches;

    const additionalCompletionProvider = this.findAutoCompletionProperty(
      document,
      textDocumentPosition,
      properties,
    );
    let additionalCompletion: CompletionItem[] = [];
    switch (additionalCompletionProvider) {
      case "areas":
        if (!currentCompletions.items.some((x) => x.data && x.data.isArea)) {
          additionalCompletion = await this.haConnection.getAreaCompletions();
        }
        break;
      case "entities":
        // sometimes the entities are already added, do not add them twice

        if (!currentCompletions.items.some((x) => x.data && x.data.isEntity)) {
          additionalCompletion = await this.haConnection.getEntityCompletions();
        }
        break;
      case "domains":
        // sometimes the domains are already added, do not add them twice

        if (!currentCompletions.items.some((x) => x.data && x.data.isDomain)) {
          additionalCompletion = await this.haConnection.getDomainCompletions();
        }
        break;
      case "floors":
        if (!currentCompletions.items.some((x) => x.data && x.data.isFloor)) {
          additionalCompletion = await this.haConnection.getFloorCompletions();
        }
        break;
      case "labels":
        if (!currentCompletions.items.some((x) => x.data && x.data.isLabel)) {
          additionalCompletion = await this.haConnection.getLabelCompletions();
        }
        break;
      case "services":
        if (!currentCompletions.items.some((x) => x.data && x.data.isService)) {
          additionalCompletion =
            await this.haConnection.getServiceCompletions();
        }
        break;
      case "uuids":
        // Generate UUID completions for id and unique_id properties
        additionalCompletion = this.getUuidCompletions();
        break;
    }
    return additionalCompletion;
  };

  private getUuidCompletions = (): CompletionItem[] => {
    const uuidCompletion = new UuidCompletionContribution();
    
    // Generate a single UUID completion item that works for both id and unique_id
    const generatedUuid = uuidCompletion.generateUuid("id"); // Use "id" as default, but works for both
    const completion = CompletionItem.create(generatedUuid);
    completion.detail = "Generate UUID";
    completion.kind = CompletionItemKind.Function;
    completion.insertText = generatedUuid;
    completion.documentation = {
      kind: "markdown",
      value: `Generates a proper UUID: \`${generatedUuid}\``
    };
    completion.sortText = "0000"; // High priority to appear at top
    completion.data = {};
    completion.data.isUuid = true;
    
    return [completion];
  };

  private findAutoCompletionProperty = (
    document: TextDocument,
    textDocumentPosition: Position,
    properties: { [provider: string]: string[] },
  ): string | null => {
    let currentLine = textDocumentPosition.line;
    while (currentLine >= 0) {
      const lineOffsets: number[] = getLineOffsets(document.getText());
      const start: number = lineOffsets[currentLine];
      let end = 0;
      if (lineOffsets[currentLine + 1] !== undefined) {
        end = lineOffsets[currentLine + 1] - 1;
      } else {
        end = document.getText().length;
      }
      const thisLine = document.getText().substring(start, end);

      const isOtherItemInList = thisLine.match(
        /-\s*([-"\w]+)?(\.)?([-"\w]+?)?\s*$/,
      );
      if (isOtherItemInList) {
        currentLine -= 1;
        continue;
      }
      for (const key in properties) {
        if (
          properties[key].some((propertyName) =>
            // eslint-disable-next-line no-useless-escape
            new RegExp(`(.*)${propertyName}(:)([\s]*)([\w]*)(\s*)`).test(
              thisLine,
            ),
          )
        ) {
          return key;
        }
      }
      return null;
    }
    return null;
  };
}
