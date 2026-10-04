import {
  CompletionItem,
  CompletionItemKind,
  MarkupContent,
} from "vscode-languageserver-protocol";
import axios, { Method } from "axios";
import {
  type Connection,
  type HassEntities,
  type HassServices,
  type AuthData,
  createConnection as haCreateConnection,
  Auth as HaAuth,
  subscribeEntities,
  subscribeServices,
} from "home-assistant-js-websocket";
import { IConfigurationService } from "../configuration";
import { createSocket } from "./socket";
import { RegistryCache, withTimeout } from "./registryCache";

export interface HassArea {
  area_id: string;
  floor_id: string | null;
  name: string;
  picture: string | null;
  icon: string | null;
  labels: string[];
  aliases: string[];
}

export interface HassAreas {
  [area_id: string]: HassArea;
}

export interface HassFloor {
  floor_id: string;
  name: string;
  level: number | null;
  icon: string | null;
  aliases: string[];
}

export interface HassFloors {
  [floor_id: string]: HassFloor;
}

export interface HassLabel {
  label_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
}

export interface HassDevice {
  area_id: string | null;
  configuration_url: string | null;
  config_entries: string[];
  connections: [string, string][];
  disabled_by: string | null;
  entry_type: string | null;
  hw_version: string | null;
  id: string;
  identifiers: [string, string][];
  manufacturer: string | null;
  model: string | null;
  name_by_user: string | null;
  name: string | null;
  sw_version: string | null;
  via_device_id: string | null;
  labels: string[];
}

export interface HassDevices {
  [device_id: string]: HassDevice;
}

export interface HassLabels {
  [label_id: string]: HassLabel;
}

export interface HassEntityRegistryEntry {
  area_id: string | null;
  config_entry_id: string | null;
  device_id: string | null;
  disabled_by: string | null;
  entity_category: string | null;
  entity_id: string;
  has_entity_name: boolean;
  hidden_by: string | null;
  icon: string | null;
  id: string;
  name: string | null;
  options: Record<string, any>;
  original_name: string | null;
  platform: string;
  translation_key: string | null;
  unique_id: string | null;
  labels: string[];
}

export interface HassEntityRegistry {
  [entity_id: string]: HassEntityRegistryEntry;
}

// Normal require(), and cast to the static type
// const ha =

// require("home-assistant-js-websocket/dist/haws.cjs") as typeof import("home-assistant-js-websocket");

export interface IHaConnection {
  tryConnect(): Promise<void>;
  notifyConfigUpdate(conf: any): Promise<void>;
  getAreaCompletions(): Promise<CompletionItem[]>;
  getDeviceCompletions(): Promise<CompletionItem[]>;
  getDomainCompletions(): Promise<CompletionItem[]>;
  getEntityCompletions(): Promise<CompletionItem[]>;
  getFloorCompletions(): Promise<CompletionItem[]>;
  getLabelCompletions(): Promise<CompletionItem[]>;
  getServiceCompletions(): Promise<CompletionItem[]>;
  getHassEntities(): Promise<HassEntities>;
  getHassDevices(): Promise<HassDevices | undefined>;
  getHassEntityRegistry(): Promise<HassEntityRegistry | undefined>;
  getHassServices(): Promise<HassServices>;
  resolveEntityCompletionDocumentation(entityId: string): Promise<MarkupContent | undefined>;
}

export class HaConnection implements IHaConnection {
  private connection: Connection | undefined;

  // In-flight connection attempt, shared so parallel callers (several
  // validators run at once when a file opens) don't each open a connection
  private connectPromise: Promise<void> | undefined;

  private readonly areas = new RegistryCache<HassArea, HassAreas>(
    "areas", "config/area_registry/list", "area_registry_updated", (a) => a.area_id);

  private readonly devices = new RegistryCache<HassDevice, HassDevices>(
    "devices", "config/device_registry/list", "device_registry_updated", (d) => d.id);

  private readonly entityRegistry = new RegistryCache<HassEntityRegistryEntry, HassEntityRegistry>(
    "entity registry entries", "config/entity_registry/list", "entity_registry_updated", (e) => e.entity_id);

  private readonly floors = new RegistryCache<HassFloor, HassFloors>(
    "floors", "config/floor_registry/list", "floor_registry_updated", (f) => f.floor_id);

  private readonly labels = new RegistryCache<HassLabel, HassLabels>(
    "labels", "config/label_registry/list", "label_registry_updated", (l) => l.label_id);

  private readonly registries = [this.areas, this.devices, this.entityRegistry, this.floors, this.labels];

  private hassEntities: Promise<HassEntities> | undefined;

  private hassServices: Promise<HassServices> | undefined;

  // Cache the current entities to avoid memory churn from subscription updates
  private currentEntitiesCache: HassEntities | undefined;
  private currentServicesCache: HassServices | undefined;

  // Track unsubscribe functions to prevent memory leaks
  private unsubscribeEntities: (() => void) | undefined;
  private unsubscribeServices: (() => void) | undefined;

  // Configuration of the connection that is established *or being
  // established*. Recorded when an attempt starts (not when it finishes) so
  // configuration notifications arriving mid-connect don't trigger reconnects.
  private activeConfig: {
    token?: string;
    url?: string;
    ignoreCertificates?: boolean;
  } = {};

  // Event callbacks for connection status
  public onConnectionEstablished: ((info: { name?: string; version?: string }) => void) | undefined;
  public onConnectionFailed: ((error: string) => void) | undefined;

  /** Called when an HA registry (areas, devices, ...) changed; open files can be re-validated. */
  public onRegistryUpdated: (() => void) | undefined;

  // Track the last entity count to avoid logging duplicate messages
  private lastEntityCount: number | undefined;

  constructor(private configurationService: IConfigurationService) {
    for (const registry of this.registries) {
      registry.onUpdated = () => this.onRegistryUpdated?.();
    }
  }

  public tryConnect = async (): Promise<void> => {
    try {
      await this.createConnection();
    } catch (error) {
      console.error("Failed to create initial connection:", error);
      // Don't rethrow - we want to allow partial functionality even if connection fails
    }
  };

  private createConnection(): Promise<void> {
    if (this.connection !== undefined) {
      return Promise.resolve();
    }
    if (this.connectPromise === undefined) {
      this.connectPromise = this.createConnectionInternal().finally(() => {
        this.connectPromise = undefined;
      });
    }
    return this.connectPromise;
  }

  /** Connect if needed; resolves to the connection, or undefined if HA is unreachable. */
  private async getConnection(): Promise<Connection | undefined> {
    try {
      await this.createConnection();
    } catch {
      // Already logged by createConnectionInternal / handleConnectionError
    }
    return this.connection;
  }

  private async createConnectionInternal(): Promise<void> {
    // Enhanced connection debugging
    console.log("Creating Home Assistant connection...");
    console.log(`Configuration status: ${this.configurationService.isConfigured ? "Configured" : "Not Configured"}`);
    console.log(`URL configured: ${this.configurationService.url ? "Yes" : "No"}`);
    console.log(`Token available: ${this.configurationService.token ? "Yes" : "No"}`);
    
    if (!this.configurationService.isConfigured) {
      console.log("Home Assistant is not configured, aborting connection attempt");
      return;
    }

    if (this.connection !== undefined) {
      console.log("Connection already exists, reusing existing connection");
      return;
    }

    this.activeConfig = {
      token: this.configurationService.token,
      url: this.configurationService.url,
      ignoreCertificates: this.configurationService.ignoreCertificates,
    };

    // Log connection details before creating auth
    console.log(`Creating Home Assistant connection to URL: ${this.configurationService.url}`);
    
    if (!this.configurationService.url) {
      console.error("No URL configured for Home Assistant - connection will fail");
    }
    
    if (!this.configurationService.token) {
      console.error("No token configured for Home Assistant - authentication will fail");
      console.error("Debug: ConfigurationService state:", {
        isConfigured: this.configurationService.isConfigured,
        hasURL: !!this.configurationService.url,
        hasToken: !!this.configurationService.token,
        ignoreCerts: this.configurationService.ignoreCertificates
      });
    } else {
      console.log(`Using token with length: ${this.configurationService.token.length}, first chars: ${this.configurationService.token.substring(0, 5)}...`);
    }
    
    // Create proper WebSocket URL from HTTP URL
    const hassUrl = this.configurationService.url || "";
    let wsUrl = "";
    
    if (hassUrl) {
      try {
        // Remove trailing slashes to prevent double slashes in the path
        const normalizedUrl = hassUrl.replace(/\/+$/, "");
        const url = new URL(`${normalizedUrl}/api/websocket`);
        const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
        wsUrl = `${wsProtocol}//${url.host}${url.pathname}`;
        console.log(`Generated WebSocket URL: ${wsUrl}`);
      } catch (error) {
        console.error(`Failed to generate WebSocket URL from ${hassUrl}:`, error);
      }
    }
    
    // Log token status before connection
    console.log(`Creating Home Assistant connection to URL: ${hassUrl}`);
    const hasToken = !!this.configurationService.token;
    console.log(`Token available for connection: ${hasToken ? "Yes" : "No"}`);
    if (hasToken) {
      console.log(`Token appears valid (length: ${this.configurationService.token!.length})`);
    } else {
      console.error("No token available! Authentication will fail.");
    }
    
    // Create auth object with both HTTP and WebSocket URLs
    const auth = new HaAuth({
      access_token: this.configurationService.token || "",
      expires: +new Date(new Date().getTime() + 1e11),
      wsUrl: wsUrl,
      clientId: "",
      expires_in: +new Date(new Date().getTime() + 1e11),
      refresh_token: "",
      // Custom property for HTTP URL that may be used in custom components
      hassUrl: hassUrl,
    } as AuthData);

    try {
      // Validate required connection params before attempting connection
      if (!auth.wsUrl) {
        console.error("Missing WebSocket URL - unable to connect to Home Assistant");
        this.handleConnectionError("ERR_MISSING_WS_URL");
        throw new Error("Missing WebSocket URL for Home Assistant connection");
      }
      
      if (!auth.accessToken) {
        console.error("Missing access token - Home Assistant authentication will fail");
        // Continue trying - the connection might work for non-secured endpoints
      }
      
      console.log("Connecting to Home Assistant...");
      console.log(`Using WebSocket URL: ${auth.wsUrl}`);
      
      this.connection = await haCreateConnection({
        auth,
        createSocket: async () =>
          createSocket(auth, this.configurationService.ignoreCertificates),
      });
      console.log("Connected to Home Assistant");

      // Keep registry caches in step with HA (devices re-added, areas renamed, ...)
      for (const registry of this.registries) {
        void registry.attach(this.connection);
      }

      // Notify about successful connection
      if (this.onConnectionEstablished) {
        try {
          // Get instance name if possible
          let instanceName;
          let version;
          try {
            const configResponse = await this.callApi("get", "config");
            if (configResponse && typeof configResponse === "object") {
              instanceName = configResponse.location_name;
              version = configResponse.version;
            }
          } catch (error) {
            console.log("Could not fetch Home Assistant instance name:", error);
          }
          
          // Trigger connection established callback
          this.onConnectionEstablished({
            name: instanceName,
            version: version
          });
        } catch (cbError) {
          console.error("Error in connection established callback:", cbError);
        }
      }
    } catch (error) {
      console.error("Failed to connect to Home Assistant:", error);
      
      // Notify about connection failure
      if (this.onConnectionFailed) {
        let errorMessage = "Unknown error";
        if (typeof error === "string") {
          errorMessage = error;
        } else if (error && typeof error === "object" && "message" in error) {
          errorMessage = error.message as string;
        }
        try {
          this.onConnectionFailed(errorMessage);
        } catch (cbError) {
          console.error("Error in connection failed callback:", cbError);
        }
      }
      
      this.handleConnectionError(error);
      throw error;
    }

    this.connection.addEventListener("ready", () => {
      console.log("(re-)connected to Home Assistant");
      // Registries may have changed while we were disconnected; the event
      // subscriptions themselves are restored by home-assistant-js-websocket
      for (const registry of this.registries) {
        registry.invalidate();
      }
      if (this.onConnectionEstablished) {
        this.onConnectionEstablished({ name: "Home Assistant", version: "1.0" });
      }
    });

    this.connection.addEventListener("disconnected", () => {
      console.warn("Lost connection with Home Assistant");
    });

    this.connection.addEventListener("reconnect-error", (data) => {
      console.error("Reconnect error with Home Assistant", data);
      if (this.onConnectionFailed) {
        this.onConnectionFailed("Reconnect error");
      }
    });
  }

  private handleConnectionError = (error: any) => {
    this.connection = undefined;
    // Failed attempt: the next configuration notification may retry
    this.activeConfig = {};
    
    // Ensure we have some token to use for debugging
    let tokenIndication = "(no token)";
    if (this.configurationService.token) {
      tokenIndication = `${this.configurationService.token}`.substring(0, 5) + "...";
    }
    
    // Get a more descriptive error message
    let errorText = error;
    let detailedError = "";
    
    switch (error) {
      case 1:
        errorText = "ERR_CANNOT_CONNECT";
        detailedError = "Cannot connect to the server. Check your network connection and server URL.";
        break;
      case 2:
        errorText = "ERR_INVALID_AUTH";
        detailedError = "Authentication failed. Your token may be invalid or expired.";
        break;
      case 3:
        errorText = "ERR_CONNECTION_LOST";
        detailedError = "Connection was established but then lost. The server might be restarting.";
        break;
      case 4:
        errorText = "ERR_HASS_HOST_REQUIRED";
        detailedError = "No Home Assistant host URL configured. Please set a valid host URL.";
        break;
      case "ERR_MISSING_WS_URL":
        errorText = "ERR_MISSING_WS_URL";
        detailedError = "Failed to generate WebSocket URL. Check your Host URL configuration.";
        break;
      default:
        // If it's an object with a message property, use that
        if (error && typeof error === "object" && "message" in error) {
          detailedError = error.message;
        } else if (error && typeof error === "object" && "code" in error) {
          // Node.js networking errors
          errorText = `Network Error: ${error.code}`;
          if (error.code === "ENOTFOUND") {
            detailedError = "Host not found. Check your server URL and network connection.";
          } else if (error.code === "ECONNREFUSED") {
            detailedError = "Connection refused. Verify the server is running and accessible.";
          } else {
            detailedError = `Error connecting to server: ${error.code}`;
          }
        }
    }
    
    // Log detailed diagnostics
    console.error(`Error connecting to Home Assistant Server at ${this.configurationService.url || "(no URL)"}`);
    console.error(`Token: ${tokenIndication}`);
    console.error(`Error code: ${errorText}`);
    console.error(`Details: ${detailedError || "No additional details"}`);
    
    // Also log the full message for backwards compatibility
    const message = `Error connecting to your Home Assistant Server at ${this.configurationService.url || "(no URL)"} and token '${tokenIndication}', check your network or update your VS Code Settings, make sure to (also) check your workspace settings! Error: ${errorText} - ${detailedError}`;
    console.error(message);
  };

  public notifyConfigUpdate = async (): Promise<void> => {
    console.log("Configuration update detected, checking if reconnection is needed...");

    // Let an in-flight attempt finish first; it records activeConfig up front,
    // so duplicate notifications sent during startup compare as unchanged
    if (this.connectPromise) {
      await this.connectPromise.catch((): void => undefined);
    }

    const tokenChanged = this.activeConfig.token !== this.configurationService.token;
    const urlChanged = this.activeConfig.url !== this.configurationService.url;
    const certSettingChanged = this.activeConfig.ignoreCertificates !== this.configurationService.ignoreCertificates;

    if (!tokenChanged && !urlChanged && !certSettingChanged) {
      console.log("No relevant configuration changes detected, skipping reconnection");
      return;
    }

    console.log("Configuration changes detected, reconnecting to Home Assistant...");
    if (tokenChanged) {
      console.log("Token has changed, reconnection required");
    }
    if (urlChanged) {
      console.log("Server URL has changed, reconnection required");
    }
    if (certSettingChanged) {
      console.log("Certificate settings changed, reconnection required");
    }

    this.disconnect();
    this.hassEntities = undefined;
    this.hassServices = undefined;

    // createConnection reports success/failure through the callbacks
    await this.tryConnect();
  };

  private getHassAreas = async (): Promise<HassAreas | undefined> =>
    this.areas.get(await this.getConnection());

  public async getAreaCompletions(): Promise<CompletionItem[]> {
    const areas = await this.getHassAreas();

    if (!areas) {
      return [];
    }

    const completions: CompletionItem[] = [];

    for (const [, value] of Object.entries(areas)) {
      const completionItem = CompletionItem.create(`${value.area_id}`);
      completionItem.detail = value.name;
      completionItem.kind = CompletionItemKind.Variable;
      completionItem.filterText = `${value.area_id} ${value.name}`;
      completionItem.insertText = value.area_id;
      completionItem.data = {};
      completionItem.data.isArea = true;

      completionItem.documentation = {
        kind: "markdown",
        value: `**${value.area_id}** \r\n \r\n`,
      } as MarkupContent;

      let floor = value.floor_id;
      if (!floor) {
        floor = "No floor assigned";
      }
      completionItem.documentation.value += `Floor: ${floor} \r\n \r\n`;

      completions.push(completionItem);
    }
    return completions;
  }

  private getHassFloors = async (): Promise<HassFloors | undefined> =>
    this.floors.get(await this.getConnection());

  public async getFloorCompletions(): Promise<CompletionItem[]> {
    const floors = await this.getHassFloors();

    if (!floors) {
      return [];
    }

    const completions: CompletionItem[] = [];

    for (const [, value] of Object.entries(floors)) {
      const completionItem = CompletionItem.create(`${value.floor_id}`);
      completionItem.detail = value.name;
      completionItem.kind = CompletionItemKind.Variable;
      completionItem.filterText = `${value.floor_id} ${value.name}`;
      completionItem.insertText = value.floor_id;
      completionItem.data = {};
      completionItem.data.isFloor = true;

      completionItem.documentation = {
        kind: "markdown",
        value: `**${value.floor_id}** \r\n`,
      } as MarkupContent;
      completions.push(completionItem);
    }
    return completions;
  }

  private getHassDevicesInternal = async (): Promise<HassDevices | undefined> =>
    this.devices.get(await this.getConnection());

  public async getHassDevices(): Promise<HassDevices | undefined> {
    return this.getHassDevicesInternal();
  }

  public async getDeviceCompletions(): Promise<CompletionItem[]> {
    const devices = await this.getHassDevices();

    if (!devices) {
      return [];
    }

    const completions: CompletionItem[] = [];

    for (const [, value] of Object.entries(devices)) {
      const completionItem = CompletionItem.create(`${value.id}`);
      completionItem.detail = value.name || value.id;
      completionItem.kind = CompletionItemKind.Variable;
      completionItem.filterText = `${value.id} ${value.name || ""}`;
      completionItem.insertText = value.id;
      completionItem.data = {};
      completionItem.data.isDevice = true;

      completionItem.documentation = {
        kind: "markdown",
        value: `**${value.id}** \r\n \r\n`,
      } as MarkupContent;

      if (value.name) {
        completionItem.documentation.value += `Name: ${value.name} \r\n \r\n`;
      }

      if (value.manufacturer) {
        completionItem.documentation.value += `Manufacturer: ${value.manufacturer} \r\n \r\n`;
      }

      if (value.model) {
        completionItem.documentation.value += `Model: ${value.model} \r\n \r\n`;
      }

      let area = value.area_id;
      if (!area) {
        area = "No area assigned";
      }
      completionItem.documentation.value += `Area: ${area} \r\n \r\n`;

      completions.push(completionItem);
    }
    return completions;
  }

  public async getHassEntities(): Promise<HassEntities> {
    // If we have a cached value, return it immediately
    // This is updated in real-time by the subscription callback
    if (this.currentEntitiesCache !== undefined) {
      return this.currentEntitiesCache;
    }

    // If we already have a promise waiting for initial load, return it
    if (this.hassEntities !== undefined) {
      return this.hassEntities;
    }

    await this.createConnection();

    this.hassEntities = new Promise<HassEntities>(
      // eslint-disable-next-line no-async-promise-executor
      async (resolve, reject) => {
        if (!this.connection) {
          return reject();
        }

        // Unsubscribe from previous subscription to prevent memory leak
        if (this.unsubscribeEntities) {
          this.unsubscribeEntities();
          this.unsubscribeEntities = undefined;
        }

        // Subscribe to entities and update cache on every change
        // This prevents memory churn from creating new promise values on each update
        this.unsubscribeEntities = subscribeEntities(this.connection, (entities) => {
          const entityCount = Object.keys(entities).length;

          // Only log if the entity count has changed
          if (this.lastEntityCount !== entityCount) {
            if (this.lastEntityCount === undefined) {
              // Initial load
              console.log(`Got ${entityCount} entities from Home Assistant`);
            } else {
              const diff = entityCount - this.lastEntityCount;
              if (diff > 0) {
                console.log(`Got ${diff} new entities from Home Assistant (total: ${entityCount})`);
              } else {
                console.log(`${Math.abs(diff)} entities have been removed from Home Assistant (total: ${entityCount})`);
              }
            }
            this.lastEntityCount = entityCount;
          }

          // Update the cache with the latest entities
          // This is more memory-efficient than creating new promises on each update
          this.currentEntitiesCache = entities;

          // Only resolve the promise once (on first load)
          resolve(entities);
        });
      },
    );
    return this.forgetIfFailed(this.hassEntities, "entities", () => this.hassEntities, () => {
      this.hassEntities = undefined;
    });
  }

  /**
   * Bound the first load of a subscription-backed cache. A rejected or
   * timed-out load is not kept, so the next call retries once HA is reachable
   * instead of every caller failing (or waiting) for the rest of the session.
   */
  private forgetIfFailed<T>(
    initial: Promise<T>,
    label: string,
    current: () => Promise<T> | undefined,
    clear: () => void,
  ): Promise<T> {
    const bounded = withTimeout(initial, 30000, `Initial ${label} load`);
    bounded.catch((error) => {
      console.log(`Could not load ${label} from Home Assistant:`, error);
      if (current() === initial) {
        clear();
      }
    });
    return bounded;
  }

  private getHassEntityRegistryInternal = async (): Promise<HassEntityRegistry | undefined> =>
    this.entityRegistry.get(await this.getConnection());

  public async getHassEntityRegistry(): Promise<HassEntityRegistry | undefined> {
    return this.getHassEntityRegistryInternal();
  }

  private getHassLabels = async (): Promise<HassLabels | undefined> =>
    this.labels.get(await this.getConnection());

  public async getLabelCompletions(): Promise<CompletionItem[]> {
    const labels = await this.getHassLabels();

    if (!labels) {
      return [];
    }

    const completions: CompletionItem[] = [];

    for (const [, value] of Object.entries(labels)) {
      const completionItem = CompletionItem.create(`${value.label_id}`);
      completionItem.detail = value.name;
      completionItem.kind = CompletionItemKind.Variable;
      completionItem.filterText = `${value.label_id} ${value.name}`;
      completionItem.insertText = value.label_id;
      completionItem.data = {};
      completionItem.data.isLabel = true;

      completionItem.documentation = {
        kind: "markdown",
        value: `**${value.label_id}** \r\n`,
      } as MarkupContent;
      completions.push(completionItem);
    }
    return completions;
  }

  private async getAreaName(areaId: string | undefined): Promise<string | null> {
    if (!areaId) {
      return null;
    }

    const areas = await this.getHassAreas();
    return areas?.[areaId]?.name || areaId;
  }

  private async getFloorName(areaId: string | undefined): Promise<string | null> {
    if (!areaId) {
      return null;
    }

    // Read floor_id from the area registry directly (this used to be parsed
    // back out of the area completion's markdown documentation)
    const areas = await this.getHassAreas();
    const floorId = areas?.[areaId]?.floor_id;
    if (!floorId) {
      return null;
    }
    const floors = await this.getHassFloors();
    return floors?.[floorId]?.name || floorId;
  }

  private async getDeviceForEntity(entityId: string): Promise<{ area_id: string | null; id: string } | null> {
    if (!entityId) {
      return null;
    }

    try {
      // Get the entity registry entry to find device_id
      const entityRegistry = await this.getHassEntityRegistry();
      const entityEntry = entityRegistry?.[entityId];
      
      if (!entityEntry || !entityEntry.device_id) {
        return null;
      }

      // Get the device information
      const devices = await this.getHassDevices();
      const device = devices?.[entityEntry.device_id];
      
      if (!device) {
        return null;
      }

      return {
        area_id: device.area_id,
        id: device.id
      };
    } catch (error) {
      console.log("Error getting device for entity:", error);
      return null;
    }
  }

  public async getEntityCompletions(): Promise<CompletionItem[]> {
    const entities = await this.getHassEntities();

    if (!entities) {
      return [];
    }

    const completions: CompletionItem[] = [];

    for (const [, value] of Object.entries(entities)) {
      const completionItem = CompletionItem.create(`${value.entity_id}`);
      completionItem.detail = value.attributes.friendly_name;
      completionItem.kind = CompletionItemKind.Variable;
      completionItem.filterText = `${value.entity_id} ${value.attributes.friendly_name}`;
      completionItem.insertText = value.entity_id;
      completionItem.data = {
        isEntity: true,
        entityId: value.entity_id,
      };

      // Don't generate documentation upfront - this causes massive performance issues
      // with hundreds/thousands of entities. Documentation will be lazy-loaded on-demand
      // in onCompletionResolve when the user actually selects/focuses the completion item.

      completions.push(completionItem);
    }
    return completions;
  }

  private safeStringify(value: any, maxLength = 200): string {
    try {
      // Handle primitives
      if (value === null || value === undefined) {
        return String(value);
      }
      if (typeof value === "string") {
        return value.length > maxLength ? value.substring(0, maxLength) + "..." : value;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }

      // Handle arrays
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return "[]";
        }
        // Only show first few items to avoid very long strings
        const items = value.slice(0, 3).map(item => {
          if (typeof item === "object") {
            return "[object]";
          }
          return String(item);
        });
        const result = items.join(", ");
        const suffix = value.length > 3 ? ` ... (${value.length - 3} more)` : "";
        return result + suffix;
      }

      // Handle objects with circular reference protection
      if (typeof value === "object") {
        try {
          const seen = new WeakSet();
          const str = JSON.stringify(value, (_key, val) => {
            if (typeof val === "object" && val !== null) {
              if (seen.has(val)) {
                return "[Circular]";
              }
              seen.add(val);
            }
            return val;
          });
          return str.length > maxLength ? str.substring(0, maxLength) + "..." : str;
        } catch {
          return "[object]";
        }
      }

      return String(value);
    } catch (error) {
      return "[error converting value]";
    }
  }

  private async createEntityCompletionMarkdown(entity: any): Promise<string> {
    // Show friendly name on top, fallback to entity_id if missing
    let markdown = "";

    // Get device and area information for contextual display
    const deviceInfo = await this.getDeviceForEntity(entity.entity_id);
    const areaName = deviceInfo ? await this.getAreaName(deviceInfo.area_id) : null;
    const floorName = deviceInfo ? await this.getFloorName(deviceInfo.area_id) : null;

    // Add contextual information (device, area, floor) right after entity name
    if (areaName || floorName) {
      if (areaName) {
        markdown += `📍 ${areaName}\n`;
      }
      if (floorName) {
        markdown += `🏠 ${floorName}\n`;
      }
      markdown += "\n";
    }

    // Current state
    if (entity.state !== undefined) {
      let stateDisplay = `**Current State:** \`${entity.state}\``;

      // Add unit of measurement if available
      if (entity.attributes?.unit_of_measurement) {
        stateDisplay += ` ${entity.attributes.unit_of_measurement}`;
      }
      markdown += stateDisplay + "\n\n";
    }

    // Last changed/updated information
    if (entity.last_changed) {
      try {
        const lastChanged = new Date(entity.last_changed);
        markdown += `**Last Changed:** ${lastChanged.toLocaleString()}\n\n`;
      } catch {
        // If date parsing fails, show raw value
        markdown += `**Last Changed:** ${entity.last_changed}\n\n`;
      }
    }

    // All attributes table (excluding useless ones)
    const attributeEntries: [string, string][] = [];

    // Add all attributes except filtered ones
    if (entity.attributes) {
      for (const [attr, value] of Object.entries(entity.attributes)) {
        // Filter out useless or redundant attributes
        if (attr === "supported_features" || attr === "friendly_name") {
          continue;
        }

        if (value !== undefined && value !== null) {
          const displayValue = this.safeStringify(value);
          attributeEntries.push([attr, displayValue]);
        }
      }
    }

    if (attributeEntries.length > 0) {
      // Sort attributes alphabetically
      attributeEntries.sort((a, b) => a[0].localeCompare(b[0]));

      markdown += "| Attribute | Value |\n";
      markdown += "|:----------|:------|\n";

      for (const [attr, displayValue] of attributeEntries) {
        markdown += `| ${attr} | ${displayValue} |\n`;
      }
      markdown += "\n";
    }

    return markdown;
  }

  public async resolveEntityCompletionDocumentation(entityId: string): Promise<MarkupContent | undefined> {
    try {
      const entities = await this.getHassEntities();
      if (!entities) {
        return undefined;
      }

      const entity = Object.values(entities).find((e: any) => e.entity_id === entityId);
      if (!entity) {
        return undefined;
      }

      return {
        kind: "markdown",
        value: await this.createEntityCompletionMarkdown(entity),
      } as MarkupContent;
    } catch (error) {
      console.error(`Error resolving entity completion documentation for ${entityId}:`, error);
      return undefined;
    }
  }

  public async getDomainCompletions(): Promise<CompletionItem[]> {
    const entities = await this.getHassEntities();
    let domains = [];

    if (!entities) {
      return [];
    }

    for (const [, value] of Object.entries(entities)) {
      domains.push(value.entity_id.split(".")[0]);
    }
    domains = [...new Set(domains)];

    const completions: CompletionItem[] = [];
    for (const domain of domains) {
      const completionItem = CompletionItem.create(domain);
      completionItem.kind = CompletionItemKind.Variable;
      completionItem.data = {};
      completionItem.data.isDomain = true;
      completions.push(completionItem);
    }
    return completions;
  }

  public async getHassServices(): Promise<HassServices> {
    // If we have a cached value, return it immediately
    // This is updated in real-time by the subscription callback
    if (this.currentServicesCache !== undefined) {
      return this.currentServicesCache;
    }

    // If we already have a promise waiting for initial load, return it
    if (this.hassServices !== undefined) {
      return this.hassServices;
    }

    await this.createConnection();

    this.hassServices = new Promise<HassServices>(
      // eslint-disable-next-line no-async-promise-executor
      async (resolve, reject) => {
        if (!this.connection) {
          return reject();
        }

        // Unsubscribe from previous subscription to prevent memory leak
        if (this.unsubscribeServices) {
          this.unsubscribeServices();
          this.unsubscribeServices = undefined;
        }

        // Subscribe to services and update cache on every change
        // This prevents memory churn from creating new promise values on each update
        this.unsubscribeServices = subscribeServices(this.connection, (services: HassServices) => {
          console.log(
            `Got ${Object.keys(services).length} services from Home Assistant`,
          );

          // Update the cache with the latest services
          // This is more memory-efficient than creating new promises on each update
          this.currentServicesCache = services;

          // Only resolve the promise once (on first load)
          return resolve(services);
        });
      },
    );
    return this.forgetIfFailed(this.hassServices, "services", () => this.hassServices, () => {
      this.hassServices = undefined;
    });
  };

  public async getServiceCompletions(): Promise<CompletionItem[]> {
    const services = await this.getHassServices();

    if (!services) {
      return [];
    }

    const completions: CompletionItem[] = [];

    for (const [domainKey, domainValue] of Object.entries(services)) {
      for (const [serviceKey, serviceValue] of Object.entries(domainValue)) {
        const completionItem = CompletionItem.create(
          `${domainKey}.${serviceKey}`,
        );
        completionItem.kind = CompletionItemKind.EnumMember;
        completionItem.filterText = `${domainKey}.${serviceKey}`;
        completionItem.insertText = completionItem.filterText;
        completionItem.data = {};
        completionItem.data.isService = true;

        const fields = Object.entries(serviceValue.fields);

        if (fields.length > 0) {
          completionItem.documentation = {
            kind: "markdown",
            value: `**${domainKey}.${serviceKey}:** \r\n \r\n`,
          } as MarkupContent;

          completionItem.documentation.value +=
            "| Field | Description | Example | \r\n";
          completionItem.documentation.value +=
            "| :---- | :---- | :---- | \r\n";

          for (const [fieldKey, fieldValue] of fields) {
            completionItem.documentation.value += `| ${fieldKey} | ${fieldValue.description} |  ${fieldValue.example} | \r\n`;
          }
        }
        completions.push(completionItem);
      }
    }

    return completions;
  }

  public disconnect(): void {
    if (!this.connection) {
      return;
    }
    console.log("Disconnecting from Home Assistant");

    // Unsubscribe from all subscriptions to prevent memory leaks
    if (this.unsubscribeEntities) {
      this.unsubscribeEntities();
      this.unsubscribeEntities = undefined;
    }
    if (this.unsubscribeServices) {
      this.unsubscribeServices();
      this.unsubscribeServices = undefined;
    }

    // Clear caches to release memory immediately on disconnect
    this.currentEntitiesCache = undefined;
    this.currentServicesCache = undefined;
    for (const registry of this.registries) {
      registry.detach();
      registry.invalidate();
    }

    this.connection.close();
    this.connection = undefined;

    // Notify about disconnection if handler exists
    if (this.onConnectionFailed) {
      try {
        this.onConnectionFailed("Disconnected");
      } catch (error) {
        console.error("Error in connection failed callback during disconnect:", error);
      }
    }
  }

  public getErrorLog = async (): Promise<string> => {
    if (!this.connection) {
      return "Not connected to Home Assistant";
    }
    interface LogEntry {
      name: string;
      message: string[];
      level: string;
      source: [string, number];
      timestamp: number;
      exception: string;
      count: number;
      first_occurred: number;
    }
    const entries = await this.connection.sendMessagePromise<LogEntry[]>({
      type: "system_log/list",
    });
    return entries
      .map((entry) => {
        const date = new Date(entry.timestamp * 1000).toLocaleString();
        const messages = entry.message.join("\n");
        const src = `${entry.source[0]}:${entry.source[1]}`;
        const count = entry.count > 1 ? ` (×${entry.count})` : "";
        const parts = [
          `${date} ${entry.level} [${entry.name}] (${src})${count}`,
          messages,
        ];
        if (entry.exception) {
          parts.push(entry.exception);
        }
        return parts.join("\n");
      })
      .join("\n\n---\n\n");
  };

  public callApi = async (
    method: Method,
    api: string,
    requestBody?: any,
  ): Promise<any> => {
    try {
      const resp = await axios.request({
        method,
        url: `${this.configurationService.url}/api/${api}`,
        headers: {
          Authorization: `Bearer ${this.configurationService.token}`,
        },
        data: requestBody,
      });

      return resp.data;
    } catch (error) {
      console.error(`Error calling API ${api}:`, error);
      
      // Extract error information for better error messages
      if (error.response) {
        // The request was made and the server responded with a status code outside of 2xx range
        console.error(`Response status: ${error.response.status}`);
        console.error("Response data:", error.response.data);
        
        // Return the error data to allow the caller to handle it
        return error.response.data;
      } else if (error.request) {
        // The request was made but no response was received
        return { error: "No response received from Home Assistant" };
      } else {
        // Something happened in setting up the request
        if (typeof error === "object" && error !== null) {
          if (error.message) {
            return { error: error.message };
          }
          try {
            return { error: JSON.stringify(error) };
          } catch {
            return { error: "Unknown error occurred" };
          }
        }
        return { error: String(error) };
      }
    }
    return Promise.resolve("");
  };

  public callService = async (
    domain: string,
    service: string,

    serviceData: any,
  ): Promise<any> => {
    try {
      const resp = await axios.request({
        method: "POST",
        url: `${this.configurationService.url}/api/services/${domain}/${service}`,
        headers: {
          Authorization: `Bearer ${this.configurationService.token}`,
        },
        data: serviceData,
      });

      console.log(
        `Service Call ${domain}.${service} made succesfully, response:`,
      );
      console.log(JSON.stringify(resp.data, null, 1));
    } catch (error) {
      console.error(error);
    }
    return Promise.resolve();
  };
}
