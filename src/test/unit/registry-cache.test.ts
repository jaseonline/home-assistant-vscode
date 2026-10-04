import * as assert from "assert";
import { RegistryCache } from "../../language-service/src/home-assistant/registryCache";

interface Item {
  id: string;
}

/** Minimal stand-in for a home-assistant-js-websocket Connection. */
class FakeConnection {
  public sent = 0;
  public eventCallback: (() => void) | undefined;
  public responses: (() => Promise<Item[]>)[] = [];

  sendMessagePromise<T>(): Promise<T> {
    this.sent++;
    const next = this.responses.shift() ?? (() => Promise.resolve([{ id: "a" }]));
    return next() as unknown as Promise<T>;
  }

  async subscribeEvents(callback: () => void): Promise<() => void> {
    this.eventCallback = callback;
    return () => {
      this.eventCallback = undefined;
    };
  }
}

const makeCache = (timeoutMs = 1000) =>
  new RegistryCache<Item>("items", "items/list", "item_registry_updated", (i) => i.id, timeoutMs);

suite("Registry cache", () => {
  test("fetches once and shares the result", async () => {
    const conn = new FakeConnection();
    const cache = makeCache();

    const [a, b] = await Promise.all([cache.get(conn as any), cache.get(conn as any)]);

    assert.strictEqual(conn.sent, 1);
    assert.deepStrictEqual(a, { a: { id: "a" } });
    assert.strictEqual(a, b);
  });

  test("a failed fetch resolves to undefined and is retried on the next call", async () => {
    const conn = new FakeConnection();
    conn.responses.push(() => Promise.reject(new Error("socket closed")));
    const cache = makeCache();

    assert.strictEqual(await cache.get(conn as any), undefined);
    assert.deepStrictEqual(await cache.get(conn as any), { a: { id: "a" } });
    assert.strictEqual(conn.sent, 2);
  });

  test("a request that never answers times out instead of hanging", async () => {
    const conn = new FakeConnection();
    conn.responses.push(() => new Promise<Item[]>(() => undefined));
    const cache = makeCache(50);

    const started = Date.now();
    assert.strictEqual(await cache.get(conn as any), undefined);
    assert.ok(Date.now() - started < 1000, "should give up after the timeout");
  });

  test("a registry_updated event drops the cache and notifies", async () => {
    const conn = new FakeConnection();
    const cache = makeCache();
    let notified = 0;
    cache.onUpdated = () => notified++;

    await cache.attach(conn as any);
    await cache.get(conn as any);
    conn.responses.push(() => Promise.resolve([{ id: "b" }]));
    conn.eventCallback!();

    assert.strictEqual(notified, 1);
    assert.deepStrictEqual(await cache.get(conn as any), { b: { id: "b" } });
    assert.strictEqual(conn.sent, 2);

    cache.detach();
    assert.strictEqual(conn.eventCallback, undefined);
  });

  test("no connection resolves to undefined without fetching", async () => {
    assert.strictEqual(await makeCache().get(undefined), undefined);
  });
});
