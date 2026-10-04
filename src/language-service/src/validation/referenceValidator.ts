import { Diagnostic, Range, TextDocument } from "vscode-languageserver-protocol";
import { AreaCompletionContribution } from "../completionHelpers/areas";
import { DeviceCompletionContribution } from "../completionHelpers/deviceIds";
import { EntityIdCompletionContribution } from "../completionHelpers/entityIds";
import { FloorCompletionContribution } from "../completionHelpers/floors";
import { LabelCompletionContribution } from "../completionHelpers/labels";
import { SecretsCompletionContribution } from "../completionHelpers/secrets";
import { ServicesCompletionContribution } from "../completionHelpers/services";
import { HomeAssistantConfiguration } from "../haConfig/haConfig";
import { HaConnection } from "../home-assistant/haConnection";
import { findReferenceValues, ReferenceMatch, TARGET_ANCESTOR_KEYS } from "./referenceScanner";

/**
 * Checks references in a document against the live Home Assistant registries
 * (entities, areas, devices, floors, labels, actions) and secrets.yaml.
 * Each check skips itself when its data is unavailable (e.g. HA offline).
 */
export class ReferenceValidator {
  constructor(
    private haConnection: HaConnection,
    private haConfig: HomeAssistantConfiguration,
  ) {}

  /** All reference diagnostics, in a stable order. The checks are independent, so they run in parallel. */
  public validate = async (document: TextDocument): Promise<Diagnostic[]> => {
    const results = await Promise.all([
      this.validateEntityIds(document),
      this.validateAreaIds(document),
      this.validateDeviceIds(document),
      this.validateFloorIds(document),
      this.validateSecrets(document),
      this.validateLabelIds(document),
      this.validateActionIds(document),
    ]);
    return results.flat();
  };

  private validateEntityIds = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    try {
      // Get all entities from Home Assistant
      const entities = await this.haConnection.getHassEntities();
      if (!entities) {
        // If we can't get entities (e.g., not connected), don't validate
        console.log("Entity validation skipped: No entities available from Home Assistant");
        return [];
      }

      const entityIds = Object.keys(entities);
      console.log(`Entity validation: Found ${entityIds.length} entities from Home Assistant`);

      const matches = findReferenceValues(document.getText().split("\n"), EntityIdCompletionContribution.propertyMatches);

      return matches
        .filter((m) => /^[a-z_]+\.[a-z0-9_]+$/.test(m.value) && !entityIds.includes(m.value))
        .map((m) => this.unknownReferenceDiagnostic(m, "Entity", "unknown-entity"));
    } catch (error) {
      // If validation fails (e.g., HA not connected), silently skip
      console.log("Entity validation skipped:", error);
      return [];
    }
  };

  private validateAreaIds = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    try {
      // Get all areas from Home Assistant
      const areaCompletions = await this.haConnection.getAreaCompletions();
      if (!areaCompletions || areaCompletions.length === 0) {
        // If we can't get areas (e.g., not connected), don't validate
        console.log("Area validation skipped: No areas available from Home Assistant");
        return [];
      }

      const areaIds = areaCompletions.map((area) => area.label as string);
      console.log(`Area validation: Found ${areaIds.length} areas from Home Assistant`);

      // Plain `area` is also a display/style key in custom cards, so only
      // treat it as a reference where HA accepts target fields.
      const matches = findReferenceValues(document.getText().split("\n"), AreaCompletionContribution.propertyMatches, {
        requireAncestorFor: ["area"],
        ancestorKeys: TARGET_ANCESTOR_KEYS,
      });

      return matches
        .filter((m) => !areaIds.includes(m.value))
        .map((m) => this.unknownReferenceDiagnostic(m, "Area", "unknown-area"));
    } catch (error) {
      // If validation fails (e.g., HA not connected), silently skip
      console.log("Area validation skipped:", error);
      return [];
    }
  };

  private validateDeviceIds = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    try {
      // Get all devices from Home Assistant
      const deviceCompletions = await this.haConnection.getDeviceCompletions();
      if (!deviceCompletions || deviceCompletions.length === 0) {
        // If we can't get devices (e.g., not connected), don't validate
        console.log("Device validation skipped: No devices available from Home Assistant");
        return [];
      }

      const deviceIds = deviceCompletions.map((device) => device.label as string);
      console.log(`Device validation: Found ${deviceIds.length} devices from Home Assistant`);

      // Plain `device` is also a display/style key in custom cards, so only
      // treat it as a reference where HA accepts target fields.
      const matches = findReferenceValues(document.getText().split("\n"), DeviceCompletionContribution.propertyMatches, {
        requireAncestorFor: ["device"],
        ancestorKeys: TARGET_ANCESTOR_KEYS,
      });

      return matches
        .filter((m) => !deviceIds.includes(m.value))
        .map((m) => this.unknownReferenceDiagnostic(m, "Device", "unknown-device"));
    } catch (error) {
      // If validation fails (e.g., HA not connected), silently skip
      console.log("Device validation skipped:", error);
      return [];
    }
  };

  private validateFloorIds = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    try {
      // Get all floors from Home Assistant
      const floorCompletions = await this.haConnection.getFloorCompletions();
      if (!floorCompletions || floorCompletions.length === 0) {
        // If we can't get floors (e.g., not connected), don't validate
        console.log("Floor validation skipped: No floors available from Home Assistant");
        return [];
      }

      const floorIds = floorCompletions.map((floor) => floor.label as string);
      console.log(`Floor validation: Found ${floorIds.length} floors from Home Assistant`);

      // Plain `floor` is also a display/style key in custom cards, so only
      // treat it as a reference where HA accepts target fields.
      const matches = findReferenceValues(document.getText().split("\n"), FloorCompletionContribution.propertyMatches, {
        requireAncestorFor: ["floor"],
        ancestorKeys: TARGET_ANCESTOR_KEYS,
      });

      return matches
        .filter((m) => !floorIds.includes(m.value))
        .map((m) => this.unknownReferenceDiagnostic(m, "Floor", "unknown-floor"));
    } catch (error) {
      // If validation fails (e.g., HA not connected), silently skip
      console.log("Floor validation skipped:", error);
      return [];
    }
  };

  private validateSecrets = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    const diagnostics: Diagnostic[] = [];
    
    try {
      // Get all available secrets from secrets.yaml file
      const fileAccessor = this.haConfig.getFileAccessor();
      const secretsHelper = new SecretsCompletionContribution(fileAccessor);
      const availableSecrets = await secretsHelper.getAvailableSecrets();
      
      if (!availableSecrets || availableSecrets.length === 0) {
        // If we can't get secrets (e.g., no secrets.yaml file), don't validate
        console.log("Secrets validation skipped: No secrets available from secrets.yaml");
        return diagnostics;
      }

      console.log(`Secrets validation: Found ${availableSecrets.length} secrets from secrets.yaml`);
      
      const text = document.getText();
      const lines = text.split("\n");

      // Iterate through each line to find !secret references
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        
        // Skip commented lines (lines that start with # after optional whitespace)
        if (line.trim().startsWith("#")) {
          continue;
        }
        
        // Find !secret tag usage: !secret secret_name
        const secretRegex = /!secret\s+([a-zA-Z0-9_]+)/g;
        let match;
        
        while ((match = secretRegex.exec(line)) !== null) {
          const secretName = match[1].trim();
          
          // Check if secret exists in secrets.yaml
          if (!availableSecrets.includes(secretName)) {
            console.log(`Secrets validation: Found unknown secret '${secretName}' at line ${lineIndex + 1}`);
            const startColumn = match.index! + match[0].indexOf(secretName);
            const endColumn = startColumn + secretName.length;
            
            const diagnostic: Diagnostic = {
              severity: 2, // Warning
              range: Range.create(
                lineIndex,
                startColumn,
                lineIndex,
                endColumn,
              ),
              message: `Secret '${secretName}' does not exist in your secrets.yaml file`,
              source: "home-assistant",
              code: "unknown-secret",
            };
            
            diagnostics.push(diagnostic);
          }
        }
      }
    } catch (error) {
      // If validation fails (e.g., HA not connected), silently skip
      console.log("Secrets validation skipped:", error);
    }
    
    return diagnostics;
  };

  private isInActionContext(lines: string[], currentLineIndex: number): boolean {
    // Check if we're within an automation action section or script sequence
    const currentLine = lines[currentLineIndex];
    
    // Get the indentation level of the current line
    const currentIndentMatch = currentLine.match(/^(\s*)/);
    const currentIndentLevel = currentIndentMatch ? currentIndentMatch[1].length : 0;
    
    // Track contexts as we go up
    let inActionOrSequenceBlock = false;
    let inAutomationOrScript = false;
    let lowestRelevantIndent = currentIndentLevel;
    
    // Look backwards through the file to understand context
    for (let i = currentLineIndex - 1; i >= 0; i--) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (trimmedLine === "" || trimmedLine.startsWith("#")) {
        continue;
      }
      
      // Get indentation of this line
      const indentMatch = line.match(/^(\s*)/);
      const lineIndent = indentMatch ? indentMatch[1].length : 0;
      
      // Only look at lines that could be parent contexts (less indented)
      if (lineIndent < lowestRelevantIndent) {
        lowestRelevantIndent = lineIndent;
        
        // Check for action/actions/sequence blocks
        if (trimmedLine.match(/^(action|actions|sequence)\s*:\s*$/)) {
          inActionOrSequenceBlock = true;
        }
        
        // Check for automation or script at root level
        if (lineIndent === 0) {
          if (trimmedLine.match(/^(automation|script)\s*:/)) {
            inAutomationOrScript = true;
          }
          // Stop if we hit another root-level key
          else if (!trimmedLine.startsWith("#")) {
            break;
          }
        }
      }
    }
    
    // We're in a valid action context if we're inside an action/sequence block
    // within an automation or script section
    return inActionOrSequenceBlock && inAutomationOrScript;
  }

  private validateLabelIds = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    try {
      // Get all labels from Home Assistant
      const labelCompletions = await this.haConnection.getLabelCompletions();
      if (!labelCompletions || labelCompletions.length === 0) {
        // If we can't get labels (e.g., not connected), don't validate
        console.log("Label validation skipped: No labels available from Home Assistant");
        return [];
      }

      const labelIds = labelCompletions.map((label) => label.label as string);
      console.log(`Label validation: Found ${labelIds.length} labels from Home Assistant`);

      // Plain `label` is also a display/style key in custom cards, so only
      // treat it as a reference where HA accepts target fields.
      const matches = findReferenceValues(document.getText().split("\n"), LabelCompletionContribution.propertyMatches, {
        requireAncestorFor: ["label"],
        ancestorKeys: TARGET_ANCESTOR_KEYS,
      });

      return matches
        .filter((m) => !labelIds.includes(m.value))
        .map((m) => this.unknownReferenceDiagnostic(m, "Label", "unknown-label"));
    } catch (error) {
      // If validation fails (e.g., HA not connected), silently skip
      console.log("Label validation skipped:", error);
      return [];
    }
  };

  private validateActionIds = async (
    document: TextDocument,
  ): Promise<Diagnostic[]> => {
    try {
      // Get all services from Home Assistant
      const services = await this.haConnection.getHassServices();
      if (!services) {
        // If we can't get actions (e.g., not connected), don't validate
        console.log("Action validation skipped: No actions available from Home Assistant");
        return [];
      }

      // Build a set of all available action IDs for quick lookup
      const actionIds = new Set<string>();
      for (const domain in services) {
        for (const serviceName in services[domain]) {
          actionIds.add(`${domain}.${serviceName}`);
        }
      }

      console.log(`Action validation: Found ${actionIds.size} actions from Home Assistant`);

      const lines = document.getText().split("\n");
      const matches = findReferenceValues(lines, ServicesCompletionContribution.propertyMatches);

      // `action:` is also a card tap-action key, so only validate inside
      // automation/script action blocks and only domain.service values.
      return matches
        .filter(
          (m) =>
            /^[a-z_]+\.[a-z0-9_]+$/.test(m.value) &&
            !actionIds.has(m.value) &&
            this.isInActionContext(lines, m.line),
        )
        .map((m) => this.unknownReferenceDiagnostic(m, "Action", "unknown-action"));
    } catch (error) {
      // If validation fails (e.g., HA not connected), silently skip
      console.log("Action validation skipped:", error);
      return [];
    }
  };

  private unknownReferenceDiagnostic(match: ReferenceMatch, kind: string, code: string): Diagnostic {
    return {
      severity: 2, // Warning
      range: Range.create(match.line, match.startColumn, match.line, match.endColumn),
      message: `${kind} '${match.value}' does not exist in your Home Assistant instance`,
      source: "home-assistant",
      code,
    };
  }
}
