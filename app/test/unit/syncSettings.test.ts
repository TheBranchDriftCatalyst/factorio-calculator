// Targets the gist-id normalizer that's NOT exported from SyncSettings
// directly — we reproduce its logic here as a fixture and pin the
// expected behaviors. If the regex/parsing in SyncSettings changes,
// keep this in sync.

import { describe, it, expect } from "vitest"

function normalizeGistId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.includes("/")) {
    const parts = trimmed.split(/[\/?#]/).filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^[0-9a-fA-F]{20,}$/.test(parts[i])) return parts[i].toLowerCase()
    }
    return null
  }
  if (/^[0-9a-fA-F]{20,}$/.test(trimmed)) return trimmed.toLowerCase()
  return null
}

describe("SyncSettings · normalizeGistId", () => {
  it("accepts a bare 32-hex gist id", () => {
    expect(normalizeGistId("1a2b3c4d5e6f7890abcdef1234567890")).toBe(
      "1a2b3c4d5e6f7890abcdef1234567890",
    )
  })

  it("lowercases the result", () => {
    expect(normalizeGistId("ABCDEF1234567890ABCDEF1234567890")).toBe(
      "abcdef1234567890abcdef1234567890",
    )
  })

  it("extracts id from a gist URL", () => {
    const url = "https://gist.github.com/user/1a2b3c4d5e6f7890abcdef1234567890"
    expect(normalizeGistId(url)).toBe("1a2b3c4d5e6f7890abcdef1234567890")
  })

  it("extracts id from a userless gist URL", () => {
    const url = "https://gist.github.com/1a2b3c4d5e6f7890abcdef1234567890"
    expect(normalizeGistId(url)).toBe("1a2b3c4d5e6f7890abcdef1234567890")
  })

  it("rejects human-readable names like 'factorio'", () => {
    expect(normalizeGistId("factorio")).toBeNull()
    expect(normalizeGistId("my-gist")).toBeNull()
  })

  it("rejects partial / too-short ids", () => {
    expect(normalizeGistId("abc123")).toBeNull()
  })

  it("rejects ids with non-hex characters", () => {
    expect(normalizeGistId("1a2b3c4d5e6f7890abcdef123456789g")).toBeNull()
  })

  it("returns null on empty / whitespace", () => {
    expect(normalizeGistId("")).toBeNull()
    expect(normalizeGistId("   ")).toBeNull()
  })

  it("ignores trailing query/hash in URL", () => {
    const url = "https://gist.github.com/user/1a2b3c4d5e6f7890abcdef1234567890#revisions"
    expect(normalizeGistId(url)).toBe("1a2b3c4d5e6f7890abcdef1234567890")
  })
})
