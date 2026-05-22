import { describe, it, expect, beforeEach, vi } from "vitest"
import { LocalStorageKVStore } from "../../src/storage/local"
import { MemoryKVStore } from "../../src/storage/memory"
import { CachingKVStore } from "../../src/storage/caching"
import { GistKVStore } from "../../src/storage/gist"
import { getJson, setJson } from "../../src/storage/types"

describe("storage · MemoryKVStore", () => {
  let store: MemoryKVStore
  beforeEach(() => {
    store = new MemoryKVStore()
  })

  it("round-trips string values", async () => {
    await store.set("a", "1")
    expect(await store.get("a")).toBe("1")
  })

  it("returns null on missing keys", async () => {
    expect(await store.get("missing")).toBeNull()
  })

  it("removes keys", async () => {
    await store.set("a", "1")
    await store.remove("a")
    expect(await store.get("a")).toBeNull()
  })

  it("lists keys with prefix filtering", async () => {
    await store.set("fbp.a", "1")
    await store.set("fbp.b", "2")
    await store.set("other", "3")
    expect((await store.list("fbp.")).sort()).toEqual(["fbp.a", "fbp.b"])
    expect((await store.list()).length).toBe(3)
  })
})

describe("storage · LocalStorageKVStore", () => {
  let store: LocalStorageKVStore
  beforeEach(() => {
    localStorage.clear()
    store = new LocalStorageKVStore()
  })

  it("round-trips string values via localStorage", async () => {
    await store.set("a", "1")
    expect(localStorage.getItem("a")).toBe("1")
    expect(await store.get("a")).toBe("1")
  })

  it("lists prefixed keys", async () => {
    await store.set("fbp.x", "1")
    await store.set("fbp.y", "2")
    await store.set("nope", "3")
    expect((await store.list("fbp.")).sort()).toEqual(["fbp.x", "fbp.y"])
  })

  it("respects prefix isolation when constructed with one", async () => {
    const ns = new LocalStorageKVStore("ns:")
    await ns.set("a", "1")
    expect(localStorage.getItem("ns:a")).toBe("1")
    expect(await ns.get("a")).toBe("1")
    // Top-level get should NOT see the namespaced key.
    const top = new LocalStorageKVStore()
    expect(await top.get("a")).toBeNull()
  })
})

describe("storage · getJson / setJson", () => {
  it("serializes and deserializes JSON values", async () => {
    const store = new MemoryKVStore()
    await setJson(store, "k", { a: 1, b: "two" })
    expect(await getJson(store, "k")).toEqual({ a: 1, b: "two" })
  })

  it("returns null when the stored value isn't valid JSON", async () => {
    const store = new MemoryKVStore()
    await store.set("k", "not json {")
    expect(await getJson(store, "k")).toBeNull()
  })
})

describe("storage · CachingKVStore", () => {
  it("reads from local cache first, falling back to remote on miss", async () => {
    const local = new MemoryKVStore()
    const remote = new MemoryKVStore()
    await remote.set("k", "from-remote")
    const cache = new CachingKVStore(local, remote)
    expect(await cache.get("k")).toBe("from-remote")
    // Should now be populated locally too.
    expect(await local.get("k")).toBe("from-remote")
  })

  it("writes to local first then fires remote write in the background", async () => {
    const local = new MemoryKVStore()
    const remote = new MemoryKVStore()
    const cache = new CachingKVStore(local, remote)
    await cache.set("k", "v")
    expect(await local.get("k")).toBe("v")
    // Microtasks resolve immediately so remote should also have it.
    await Promise.resolve()
    expect(await remote.get("k")).toBe("v")
  })

  it("refreshFromRemote populates local cache from remote", async () => {
    const local = new MemoryKVStore()
    const remote = new MemoryKVStore()
    await remote.set("fbp.a", "1")
    await remote.set("fbp.b", "2")
    await remote.set("other", "3")
    const cache = new CachingKVStore(local, remote)
    await cache.refreshFromRemote("fbp.")
    expect(await local.get("fbp.a")).toBe("1")
    expect(await local.get("fbp.b")).toBe("2")
    // Prefix filter excluded "other".
    expect(await local.get("other")).toBeNull()
  })

  it("list returns union of local and remote keys (deduped)", async () => {
    const local = new MemoryKVStore()
    const remote = new MemoryKVStore()
    await local.set("a", "1")
    await local.set("b", "1")
    await remote.set("b", "remote-b")
    await remote.set("c", "1")
    const cache = new CachingKVStore(local, remote)
    expect((await cache.list()).sort()).toEqual(["a", "b", "c"])
  })
})

describe("storage · GistKVStore", () => {
  beforeEach(() => {
    // vi.stubGlobal replaces window.fetch — vitest restores between tests.
    vi.restoreAllMocks()
  })

  it("returns null on get when no gistId is configured", async () => {
    // No gistId + no writes → fetchGist returns empty {} → key absent.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("should not be called"))),
    )
    const store = new GistKVStore({ token: "ghp_x" })
    expect(await store.get("k")).toBeNull()
  })

  it("creates a gist on first write and remembers the id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "abc123",
          files: { k: { filename: "k", content: "v" } },
          public: false,
        }),
    } as Response)
    vi.stubGlobal("fetch", fetchMock)
    let createdId: string | undefined
    const store = new GistKVStore({ token: "ghp_x" })
    store.onGistCreated = (id) => {
      createdId = id
    }
    await store.set("k", "v")
    expect(createdId).toBe("abc123")
    expect(store.getGistId()).toBe("abc123")
    // First fetch call should be POST /gists.
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/gists$/)
    expect(init?.method).toBe("POST")
  })

  it("returns null on bad credentials (401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401 } as Response),
    )
    const store = new GistKVStore({ token: "bad", gistId: "id" })
    expect(await store.get("k")).toBeNull()
  })

  it("testConnection reports auth failures cleanly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401 } as Response),
    )
    const store = new GistKVStore({ token: "bad" })
    expect(await store.testConnection()).toBe("Token rejected by GitHub")
  })

  it("testConnection returns null on healthy auth without a gistId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: true, status: 200 } as Response),
    )
    const store = new GistKVStore({ token: "ok" })
    expect(await store.testConnection()).toBeNull()
  })
})
