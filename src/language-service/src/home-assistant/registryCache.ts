import type { Connection } from "home-assistant-js-websocket";

/** Reject a promise that has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Cached, self-refreshing view of one Home Assistant registry
 * (areas, devices, floors, labels, entity registry).
 *
 * - The list is fetched once and shared by all callers until invalidated.
 * - `attach()` subscribes to the registry's `*_registry_updated` event, so
 *   devices/areas added or removed in HA are picked up without a restart.
 * - A failed or timed-out fetch resolves to `undefined` (callers already
 *   treat that as "registry unavailable, skip") and is not cached, so the
 *   next call retries instead of every caller waiting on a dead request.
 */
export class RegistryCache<TItem, TMap extends Record<string, TItem> = Record<string, TItem>> {
  private value: Promise<TMap | undefined> | undefined;

  private unsubscribe: (() => void) | undefined;

  /** Called after the registry changed in HA and the cache was dropped. */
  public onUpdated: (() => void) | undefined;

  constructor(
    private readonly name: string,
    private readonly listCommand: string,
    private readonly updatedEvent: string,
    private readonly keyOf: (item: TItem) => string,
    private readonly timeoutMs = 15000,
  ) {}

  public get(connection: Connection | undefined): Promise<TMap | undefined> {
    if (!connection) {
      return Promise.resolve(undefined);
    }
    if (this.value === undefined) {
      const fetch = this.fetch(connection);
      this.value = fetch;
      fetch.then((result) => {
        // Don't cache failures; only clear if no newer fetch replaced this one
        if (result === undefined && this.value === fetch) {
          this.value = undefined;
        }
      });
    }
    return this.value;
  }

  public invalidate(): void {
    this.value = undefined;
  }

  /** Subscribe to registry change events on a (new) connection. */
  public async attach(connection: Connection): Promise<void> {
    this.detach();
    try {
      this.unsubscribe = await connection.subscribeEvents(() => {
        console.log(`${this.name} registry changed in Home Assistant, refreshing`);
        this.invalidate();
        this.onUpdated?.();
      }, this.updatedEvent);
    } catch (error) {
      // Non-fatal: the cache still works, it just won't refresh until reconnect
      console.log(`Could not subscribe to ${this.updatedEvent}:`, error);
    }
  }

  public detach(): void {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {
        // Connection already closed
      }
      this.unsubscribe = undefined;
    }
  }

  private async fetch(connection: Connection): Promise<TMap | undefined> {
    try {
      const items = await withTimeout(
        connection.sendMessagePromise<TItem[]>({ type: this.listCommand }),
        this.timeoutMs,
        `${this.name} registry request`,
      );
      console.log(`Got ${items.length} ${this.name} from Home Assistant`);
      const map = {} as Record<string, TItem>;
      for (const item of items) {
        map[this.keyOf(item)] = item;
      }
      return map as TMap;
    } catch (error) {
      console.log(`Could not load ${this.name} from Home Assistant:`, error);
      return undefined;
    }
  }
}
