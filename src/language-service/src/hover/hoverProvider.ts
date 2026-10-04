import { Hover, Position, Range, TextDocument } from "vscode-languageserver-protocol";
import { LanguageService } from "yaml-language-server/out/server/src/languageservice/yamlLanguageService";
import { EntityIdCompletionContribution } from "../completionHelpers/entityIds";
import { ServicesCompletionContribution } from "../completionHelpers/services";
import { IConfigurationService } from "../configuration";
import { HaConnection } from "../home-assistant/haConnection";

/**
 * Hover content: schema docs from the YAML service, plus live entity state,
 * action documentation and rendered Jinja templates from Home Assistant.
 */
export class HoverProvider {
  private templateCache = new Map<string, { value: string; timestamp: number }>();
  private readonly CACHE_DURATION = 30000; // 30 seconds

  constructor(
    private yamlLanguageService: LanguageService,
    private haConnection: HaConnection,
    private configurationService: IConfigurationService,
  ) {}

  public onHover = async (
    document: TextDocument,
    position: Position,
  ): Promise<Hover | null> => {
    if (!document) {
      return null;
    }

    try {
      // First check for entity hover information
      const entityHover = await this.getEntityHoverInfo(document, position);
      if (entityHover) {
        return entityHover;
      }
    } catch (error) {
      console.error("Error in getEntityHoverInfo:", error);
      // Continue to try other hover providers
    }

    try {
      // Check for service hover information
      const serviceHover = await this.getServiceHoverInfo(document, position);
      if (serviceHover) {
        return serviceHover;
      }
    } catch (error) {
      console.error("Error in getServiceHoverInfo:", error);
      // Continue to try other hover providers
    }

    try {
      // Check if we're hovering over a YAML key or value
      const isOnKey = this.isHoveringOverYamlKey(document, position);

      // Only show schema hover info when hovering over keys
      if (isOnKey) {
        // Use custom hover provider instead of yaml-language-server's doHover
        // to avoid stack overflow from circular schema references
        const customHover = await this.getCustomSchemaHover(document, position);
        if (customHover) {
          return customHover;
        }
      }
    } catch (error) {
      console.error("Error checking YAML key hover:", error);
      // Continue to try template hover
    }

    try {
      // Check for template hover information when hovering over values
      const templateHover = await this.getTemplateHoverInfo(document, position);
      if (templateHover) {
        return templateHover;
      }
    } catch (error) {
      console.error("Error in getTemplateHoverInfo:", error);
      // Fall through to return null
    }

    // Don't show schema hover for values
    return null;
  };

  /**
   * Provides schema hover information using yaml-language-server.
   * Circular references have been fixed in the schemas, so this should be safe.
   */
  private async getCustomSchemaHover(
    document: TextDocument,
    position: Position,
  ): Promise<Hover | null> {
    try {
      // Schemas have been fixed to remove circular refs, so doHover should work
      return this.yamlLanguageService.doHover(document, position);
    } catch (error) {
      console.error("Error in schema hover:", error);
      return null;
    }
  }

  private isHoveringOverYamlKey(
    document: TextDocument,
    position: Position,
  ): boolean {
    try {
      const text = document.getText();
      const { line: lineNumber, character } = position;
      const line = text.split("\n")[lineNumber];
      
      // Skip if the line doesn't contain a colon (not a key-value pair)
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) {
        return false;
      }
      
      // Handle array items (lines starting with "- ")
      let effectiveLine = line;
      let characterOffset = 0;
      const arrayMatch = line.match(/^(\s*)- (.*)$/);
      if (arrayMatch) {
        // For array items, consider the part after "- " as the effective line
        effectiveLine = arrayMatch[2];
        characterOffset = arrayMatch[1].length + 2; // indent + "- "
        
        // Adjust character position relative to the effective line
        const adjustedCharacter = character - characterOffset;
        if (adjustedCharacter < 0) {
          return false; // cursor is before the actual content
        }
        
        const effectiveColonIndex = effectiveLine.indexOf(":");
        if (effectiveColonIndex === -1) {
          return false;
        }
        
        // Check if we're on the key part of the array item
        if (adjustedCharacter <= effectiveColonIndex) {
          const keyPart = effectiveLine.substring(0, effectiveColonIndex).trim();
          if (keyPart.length === 0) {
            return false;
          }
          
          const keyStart = effectiveLine.indexOf(keyPart);
          const keyEnd = keyStart + keyPart.length;
          return adjustedCharacter >= keyStart && adjustedCharacter <= keyEnd;
        }
        
        return false;
      }
      
      // Handle regular key-value pairs
      const beforeColon = character <= colonIndex;
      if (!beforeColon) {
        return false; // cursor is after the colon (on value side)
      }
      
      // Find the actual key text (trim whitespace and handle indentation)
      const lineBeforeColon = line.substring(0, colonIndex);
      const keyMatch = lineBeforeColon.match(/^(\s*)(.+?)(\s*)$/);
      
      if (!keyMatch) {
        return false;
      }
      
      const indentation = keyMatch[1];
      const keyText = keyMatch[2];
      
      if (keyText.length === 0) {
        return false;
      }
      
      // Calculate the actual key boundaries
      const keyStart = indentation.length;
      const keyEnd = keyStart + keyText.length;
      
      // Check if cursor is within the key text boundaries
      return character >= keyStart && character <= keyEnd;
      
    } catch (error) {
      console.log("Error determining YAML key position:", error);
      return false;
    }
  }

  private async getEntityHoverInfo(
    document: TextDocument,
    position: Position,
  ): Promise<Hover | null> {
    try {
      // Get the word at the position
      const text = document.getText();
      const offset = document.offsetAt(position);
      
      // Find the word boundaries
      let start = offset;
      let end = offset;
      
      // Move start backward to find start of word
      while (start > 0 && /[a-z0-9_.]/i.test(text[start - 1])) {
        start--;
      }
      
      // Move end forward to find end of word
      while (end < text.length && /[a-z0-9_.]/i.test(text[end])) {
        end++;
      }
      
      const word = text.substring(start, end);
      
      // Check if it looks like an entity ID (domain.entity_name pattern)
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(word)) {
        return null;
      }
      
      // Create a simple JSON path for the entity ID
      const location = [word];
      
      // Use EntityIdCompletionContribution to get hover info
      const entityContribution = new EntityIdCompletionContribution(this.haConnection);
      const markedStrings = await entityContribution.getInfoContribution(
        document.uri,
        location
      );
      
      if (markedStrings && markedStrings.length > 0) {
        const range = Range.create(
          document.positionAt(start),
          document.positionAt(end)
        );
        
        return {
          contents: markedStrings,
          range: range
        };
      }
      
      return null;
    } catch (error) {
      console.log("Error getting entity hover info:", error);
      return null;
    }
  }

  private async getServiceHoverInfo(
    document: TextDocument,
    position: Position,
  ): Promise<Hover | null> {
    try {
      // Get the word at the position
      const text = document.getText();
      const offset = document.offsetAt(position);
      
      // Find the word boundaries
      let start = offset;
      let end = offset;
      
      // Move start backward to find start of word
      while (start > 0 && /[a-z0-9_.]/i.test(text[start - 1])) {
        start--;
      }
      
      // Move end forward to find end of word
      while (end < text.length && /[a-z0-9_.]/i.test(text[end])) {
        end++;
      }
      
      const word = text.substring(start, end);
      
      // Check if it looks like a service ID (domain.service_name pattern)
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(word)) {
        return null;
      }
      
      // Create a simple JSON path for the service ID
      const location = [word];
      
      // Use ServicesCompletionContribution to get hover info
      const servicesContribution = new ServicesCompletionContribution(this.haConnection);
      const markedStrings = await servicesContribution.getInfoContribution(
        document.uri,
        location
      );
      
      if (markedStrings && markedStrings.length > 0) {
        const range = Range.create(
          document.positionAt(start),
          document.positionAt(end)
        );
        
        return {
          contents: markedStrings,
          range: range
        };
      }
      
      return null;
    } catch (error) {
      console.log("Error getting service hover info:", error);
      return null;
    }
  }

  private async getTemplateHoverInfo(
    document: TextDocument,
    position: Position,
  ): Promise<Hover | null> {
    try {
      // Check if auto-rendering is enabled
      if (!this.configurationService.autoRenderTemplates) {
        return null;
      }
      
      const text = document.getText();
      const { line: lineNumber, character } = position;
      const lines = text.split("\n");
      const line = lines[lineNumber];
      
      // Check if we're hovering over a template value
      const templateValue = this.extractTemplateValue(line, character);
      if (!templateValue) {
        return null;
      }
      
      // Check if the value contains template syntax
      if (!this.isTemplate(templateValue)) {
        return null;
      }
      
      // Render the template
      const renderedValue = await this.renderTemplate(templateValue);
      if (renderedValue === null) {
        return null;
      }
      
      const valueRange = this.getTemplateValueRange(line, lineNumber, templateValue);
      const syntaxHighlighting = this.getSyntaxHighlighting(renderedValue);
      
      return {
        contents: {
          kind: "markdown",
          value: `**Template Preview:**\n\n\`\`\`${syntaxHighlighting}\n${renderedValue}\n\`\`\``,
        },
        range: valueRange,
      };
    } catch (error) {
      console.log("Error getting template hover info:", error);
      return null;
    }
  }

  private extractTemplateValue(line: string, character: number): string | null {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1 || character <= colonIndex) {
      return null;
    }
    
    // Extract the value part after the colon
    const valueStart = colonIndex + 1;
    let value = line.substring(valueStart).trim();
    
    // Handle quoted strings
    if ((value.startsWith("\"") && value.endsWith("\"")) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    return value;
  }

  private isTemplate(value: string): boolean {
    return value.includes("{{") && value.includes("}}");
  }

  private async renderTemplate(template: string): Promise<string | null> {
    try {
      // Check cache first
      const cacheKey = template;
      const cached = this.templateCache.get(cacheKey);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp < this.CACHE_DURATION)) {
        return cached.value;
      }
      
      // Check if Home Assistant is properly configured
      if (!this.configurationService.isConfigured) {
        // Don't cache connection errors - they should be checked each time
        return "⚠️ Home Assistant connection not configured. Please set up your Home Assistant URL and token.";
      }
      
      // Use the existing Home Assistant connection to render the template
      if (!this.haConnection) {
        return null;
      }
      
      const result = await this.haConnection.callApi("post", "template", {
        template: template,
        strict: true,
      });
      
      let renderedValue: string;
      let isError = false;
      
      // Check for various error formats that Home Assistant can return
      if (this.isTemplateError(result)) {
        renderedValue = this.formatTemplateError(result);
        isError = true;
      } else {
        renderedValue = this.formatTemplateResult(result);
      }
      
      // Only cache successful results, not errors
      if (!isError) {
        this.templateCache.set(cacheKey, { value: renderedValue, timestamp: now });

        // Clean up expired and excessive cache entries to prevent memory leaks
        this.cleanupTemplateCache(now);
      }
      
      return renderedValue;
    } catch (error) {
      console.log("Error rendering template:", error);
      
      // Handle axios/HTTP errors that weren't caught by callApi
      if (error && typeof error === "object" && "response" in error) {
        const axiosError = error as any;
        if (axiosError.response?.data) {
          // Handle Home Assistant API errors that came through as exceptions
          if (this.isTemplateError(axiosError.response.data)) {
            return this.formatTemplateError(axiosError.response.data);
          }
        }
        
        if (axiosError.response?.status) {
          return `❌ HTTP ${axiosError.response.status}: ${axiosError.response.statusText || "Request failed"}`;
        }
      }
      
      // Provide more user-friendly error messages for common cases
      if (error instanceof Error) {
        if (error.message.includes("Invalid URL")) {
          return "⚠️ Home Assistant connection not configured. Please set up your Home Assistant URL and token.";
        } else if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
          return "⚠️ Unable to connect to Home Assistant. Please check your connection settings.";
        } else if (error.message.includes("401") || error.message.includes("Unauthorized")) {
          return "⚠️ Authentication failed. Please check your Home Assistant token.";
        } else if (error.message.includes("timeout")) {
          return "⚠️ Request timed out. Home Assistant may be slow to respond.";
        }
        
        return `❌ Error: ${error.message}`;
      }
      
      return `❌ Error: ${String(error)}`;
    }
  }

  /**
   * Cleans up the template cache by removing expired entries and enforcing size limits
   * to prevent unbounded memory growth
   */
  private cleanupTemplateCache(currentTime: number): void {
    const maxCacheSize = 100;

    // First, remove all expired entries based on CACHE_DURATION
    for (const [key, entry] of this.templateCache.entries()) {
      if (currentTime - entry.timestamp > this.CACHE_DURATION) {
        this.templateCache.delete(key);
      }
    }

    // If cache is still too large, remove oldest entries until we're at the limit
    if (this.templateCache.size > maxCacheSize) {
      // Convert to array and sort by timestamp (oldest first)
      const entries = Array.from(this.templateCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      // Calculate how many entries to remove
      const entriesToRemove = this.templateCache.size - maxCacheSize;

      // Remove the oldest entries
      for (let i = 0; i < entriesToRemove; i++) {
        this.templateCache.delete(entries[i][0]);
      }
    }
  }

  private isTemplateError(result: any): boolean {
    if (!result || typeof result !== "object") {
      return false;
    }

    // Check for common error properties
    return !!(
      result.error ||
      result.message ||
      result.detail ||
      (result.code && typeof result.code === "string")
    );
  }

  private formatTemplateError(result: any): string {
    if (!result || typeof result !== "object") {
      return "❌ Unknown template error";
    }
    
    // Handle different error formats from Home Assistant
    if (result.error) {
      return `❌ ${this.cleanErrorMessage(result.error)}`;
    }
    
    if (result.message) {
      let errorMsg = `❌ ${this.cleanErrorMessage(result.message)}`;
      
      // Add additional details if available
      if (result.detail) {
        errorMsg += `\n\nDetails: ${result.detail}`;
      }
      
      if (result.code) {
        errorMsg += `\n\nError Code: ${result.code}`;
      }
      
      return errorMsg;
    }
    
    // Handle HTTP error responses
    if (result.status && result.statusText) {
      return `❌ HTTP ${result.status}: ${result.statusText}`;
    }
    
    // Fallback for other error formats
    try {
      const errorStr = JSON.stringify(result, null, 2);
      return `❌ Template Error:\n${errorStr}`;
    } catch {
      return `❌ ${String(result)}`;
    }
  }

  private formatListString(listStr: string): string {
    try {
      // Remove the brackets and split by comma
      const content = listStr.slice(1, -1).trim();
      if (!content) {
        return "[]";
      }
      
      // Split by comma, but handle quoted strings properly
      const items: string[] = [];
      let current = "";
      let inQuotes = false;
      let quoteChar = "";
      
      for (const char of content) {
        if (!inQuotes && (char === "'" || char === "\"")) {
          inQuotes = true;
          quoteChar = char;
          current += char;
        } else if (inQuotes && char === quoteChar) {
          inQuotes = false;
          current += char;
        } else if (!inQuotes && char === ",") {
          items.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      
      // Add the last item
      if (current.trim()) {
        items.push(current.trim());
      }
      
      // Format the items nicely
      if (items.length <= 3) {
        return `[\n  ${items.join(",\n  ")}\n]`;
      } else {
        const preview = items.slice(0, 3);
        const remaining = items.length - 3;
        return `[\n  ${preview.join(",\n  ")},\n  ... (${remaining} more items)\n]`;
      }
    } catch {
      // If parsing fails, return the original string
      return listStr;
    }
  }

  private cleanErrorMessage(message: string): string {
    if (!message || typeof message !== "string") {
      return "Unknown error";
    }
    
    // Remove redundant prefixes
    let cleanMsg = message
      .replace(/^Error rendering template:\s*/i, "")
      .replace(/^Template Error:\s*/i, "")
      .replace(/^TemplateSyntaxError:\s*/i, "")
      .replace(/^Template error:\s*/i, "")
      .replace(/^Error:\s*/i, "");
    
    // Capitalize first letter if it's not already
    if (cleanMsg.length > 0) {
      cleanMsg = cleanMsg.charAt(0).toUpperCase() + cleanMsg.slice(1);
    }
    
    return cleanMsg || "Unknown error";
  }

  private getSyntaxHighlighting(value: string): string {
    // For error messages, use text highlighting
    if (value.startsWith("❌") || value.startsWith("⚠️")) {
      return "text";
    }
    
    // Detect JSON-like structures for better syntax highlighting
    if (value.startsWith("{") && value.endsWith("}")) {
      return "json";
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      return "json";
    }
    // For plain text, numbers, booleans
    if (value === "null" || value === "undefined" || value === "true" || value === "false") {
      return "json";
    }
    // Check if it's a number
    if (!isNaN(Number(value)) && value.trim() !== "") {
      return "json";
    }
    // Default to text for strings and other content
    return "text";
  }

  private formatTemplateResult(result: any, depth = 0): string {
    // Prevent stack overflow by limiting recursion depth
    const MAX_DEPTH = 10;
    if (depth > MAX_DEPTH) {
      return "[max depth exceeded]";
    }

    if (result === null) {
      return "null";
    }

    if (result === undefined) {
      return "undefined";
    }

    if (typeof result === "string") {
      // Check if the string looks like a list/array and try to format it
      const trimmed = result.trim();

      // Handle Python-style lists that Home Assistant might return
      if (trimmed.startsWith("[") && trimmed.includes(",")) {
        return this.formatListString(trimmed);
      }

      // Try to parse as JSON for objects and arrays
      if ((trimmed.startsWith("[") && trimmed.endsWith("]")) ||
          (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        try {
          const parsed = JSON.parse(trimmed);
          return this.formatTemplateResult(parsed, depth + 1); // Recursively format the parsed result
        } catch {
          // If JSON parsing fails, treat it as a list string if it looks like one
          if (trimmed.startsWith("[")) {
            return this.formatListString(trimmed);
          }
          return result;
        }
      }
      return result;
    }

    if (typeof result === "number" || typeof result === "boolean") {
      return String(result);
    }

    if (Array.isArray(result)) {
      // For arrays, format them nicely
      if (result.length === 0) {
        return "[]";
      }

      // For small arrays (≤3 items), show all items
      if (result.length <= 3) {
        return `[\n  ${result.map(item => JSON.stringify(item)).join(",\n  ")}\n]`;
      }

      // For larger arrays, show first 3 items with count
      const preview = result.slice(0, 3);
      const remaining = result.length - 3;
      return `[\n  ${preview.map(item => JSON.stringify(item)).join(",\n  ")},\n  ... (${remaining} more items)\n]`;
    }

    if (typeof result === "object") {
      try {
        const keys = Object.keys(result);

        // For empty objects
        if (keys.length === 0) {
          return "{}";
        }

        // For small objects (≤3 properties), show all
        if (keys.length <= 3) {
          return JSON.stringify(result, null, 2);
        }

        // For larger objects, show preview with count
        const preview = keys.slice(0, 3).reduce((obj, key) => {
          obj[key] = result[key];
          return obj;
        }, {} as any);

        const previewStr = JSON.stringify(preview, null, 2);
        const remainingKeys = keys.length - 3;

        // Replace the closing brace with continuation indicator
        return previewStr.slice(0, -2) + `,\n  ... (${remainingKeys} more properties)\n}`;
      } catch {
        // Fallback if JSON.stringify fails (circular references, etc.)
        return `[object ${result.constructor?.name || "Object"}]`;
      }
    }

    // Fallback for any other types
    return String(result);
  }

  private getTemplateValueRange(line: string, lineNumber: number, templateValue: string): Range {
    const colonIndex = line.indexOf(":");
    const valueStart = colonIndex + 1;
    const trimmedStart = line.substring(valueStart).indexOf(templateValue) + valueStart;
    
    return Range.create(
      Position.create(lineNumber, trimmedStart),
      Position.create(lineNumber, trimmedStart + templateValue.length)
    );
  }
}
