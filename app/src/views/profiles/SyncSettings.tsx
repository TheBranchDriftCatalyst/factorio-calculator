// Sync settings panel — lets the user pick where profiles persist.
//
// Lives inside the ProfileSidebar drawer. Opening it expands a small
// form below the profile list:
//   • Backend: [Local | GitHub Gist]
//   • (gist) Token: <pat>
//   • (gist) Gist id (optional — auto-created on first write)
//   • [Test] [Save]
//
// PAT lives in localStorage like any other setting. This is acceptable
// for client-side apps — the alternative (no persistence) would mean
// the user re-pastes the token on every reload. Document the tradeoff
// in the UI so users with sensitive PATs can opt out by clearing.

import { useState } from "react"
import { GistKVStore, runGistDiagnostics, type DiagnosticResult } from "../../storage/gist"
import { LocalStorageKVStore } from "../../storage/local"
import { useStorage, type StorageSettings } from "../../storage"

/**
 * Accepts either:
 *   • a raw gist id (20+ hex chars): "1a2b3c..."
 *   • a gist URL: "https://gist.github.com/{user}/{id}" or
 *                 "https://gist.github.com/{id}"
 * Returns the normalized hex id, or null if the input doesn't look
 * like either form (so we can show a friendly validation error
 * BEFORE hitting the GitHub API and getting a 404).
 */
function normalizeGistId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // URL form: pull the last path segment that looks like a hex id.
  if (trimmed.includes("/")) {
    const parts = trimmed.split(/[\/?#]/).filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^[0-9a-fA-F]{20,}$/.test(parts[i])) return parts[i].toLowerCase()
    }
    return null
  }
  // Raw form: must be hex.
  if (/^[0-9a-fA-F]{20,}$/.test(trimmed)) return trimmed.toLowerCase()
  return null
}

const AMBER = "#FFB000"
const AMBER_DIM = "rgba(255,176,0,0.35)"
const AMBER_FAINT = "rgba(255,176,0,0.18)"
const LABEL = "rgba(255,255,255,0.45)"
const INPUT_BG = "rgba(0,0,0,0.4)"

const FIELD_STYLE: React.CSSProperties = {
  background: INPUT_BG,
  border: `1px solid ${AMBER_DIM}`,
  color: AMBER,
  padding: "4px 6px",
  fontFamily: "inherit",
  fontSize: 11,
  outline: "none",
}

const BUTTON_STYLE: React.CSSProperties = {
  background: AMBER,
  color: "#0c0c10",
  border: "none",
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 700,
}

const GHOST_BUTTON: React.CSSProperties = {
  background: "transparent",
  color: LABEL,
  border: `1px solid ${AMBER_FAINT}`,
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
}

export function SyncSettings() {
  const { settings, setSettings, activeBackend, refreshFromRemote } = useStorage()
  const [draftBackend, setDraftBackend] = useState<StorageSettings["backend"]>(settings.backend)
  const [draftToken, setDraftToken] = useState(settings.gist?.token ?? "")
  const [draftGistId, setDraftGistId] = useState(settings.gist?.gistId ?? "")
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult | null>(null)

  // Resolve the draft gist id. Returns:
  //   { ok: true, id: undefined } — blank input (auto-create on save)
  //   { ok: true, id: "abc..." }  — normalized to lowercase hex
  //   { ok: false }               — non-empty but didn't parse
  const resolveGistId = (): { ok: true; id: string | undefined } | { ok: false } => {
    const raw = draftGistId.trim()
    if (!raw) return { ok: true, id: undefined }
    const norm = normalizeGistId(raw)
    if (!norm) return { ok: false }
    return { ok: true, id: norm }
  }

  const onTest = async () => {
    if (draftBackend !== "gist") {
      setStatus({ kind: "info", msg: "Local backend needs no test." })
      return
    }
    if (!draftToken.trim()) {
      setStatus({ kind: "err", msg: "Enter a PAT first." })
      return
    }
    const idResult = resolveGistId()
    if (!idResult.ok) {
      setStatus({
        kind: "err",
        msg: "Gist id looks invalid — paste the hex id or the gist URL (leave blank to auto-create).",
      })
      return
    }
    setTesting(true)
    setStatus({ kind: "info", msg: "Testing…" })
    try {
      const store = new GistKVStore({
        token: draftToken.trim(),
        gistId: idResult.id,
      })
      const err = await store.testConnection()
      if (err) setStatus({ kind: "err", msg: err })
      else setStatus({ kind: "ok", msg: "Auth OK." })
    } finally {
      setTesting(false)
    }
  }

  const onDiagnose = async () => {
    if (draftBackend !== "gist") {
      setStatus({ kind: "info", msg: "Diagnose is for the Gist backend only." })
      return
    }
    const token = draftToken.trim()
    if (!token) {
      setStatus({ kind: "err", msg: "Enter a PAT first." })
      return
    }
    const idResult = resolveGistId()
    if (!idResult.ok) {
      setStatus({
        kind: "err",
        msg: "Gist id looks invalid — paste the hex id or the gist URL (leave blank to skip the read-gist step).",
      })
      return
    }
    setTesting(true)
    setStatus({ kind: "info", msg: "Running diagnostics — this calls GitHub a few times…" })
    setDiagnostics(null)
    try {
      const result = await runGistDiagnostics(token, idResult.id)
      setDiagnostics(result)
      setStatus(
        result.ok
          ? { kind: "ok", msg: "Diagnostics passed — sync should work. Click Save." }
          : { kind: "err", msg: "Diagnostics found problems — see the steps below." },
      )
    } finally {
      setTesting(false)
    }
  }

  const onSave = async () => {
    if (draftBackend === "local") {
      setSettings({ backend: "local" })
      setStatus({ kind: "ok", msg: "Switched to local storage." })
      return
    }
    const token = draftToken.trim()
    if (!token) {
      setStatus({ kind: "err", msg: "Token required for Gist sync." })
      return
    }
    const idResult = resolveGistId()
    if (!idResult.ok) {
      setStatus({
        kind: "err",
        msg: "Gist id looks invalid — paste the hex id or the gist URL (leave blank to auto-create).",
      })
      return
    }

    setStatus({ kind: "info", msg: "Saving…" })
    // We work with a temporary GistKVStore directly here instead of
    // through the React context's CachingKVStore. Reason: setSettings
    // schedules a re-render, but the CachingKVStore inside the
    // context only rebuilds AFTER that render — so calling
    // pushToRemote() right now would still hit the OLD store. Doing
    // the push manually side-steps the staleness.
    let gistId = idResult.id
    const remote = new GistKVStore({ token, gistId })
    remote.onGistCreated = (id) => {
      gistId = id
    }

    // 1. Push every local profile up. If gistId was blank, the FIRST
    //    write here creates the gist via POST /gists; subsequent
    //    writes patch it. If no local profiles exist yet, we write a
    //    tiny init marker so the gist gets created and the user sees
    //    it on GitHub immediately.
    const localStore = new LocalStorageKVStore()
    const profileKeys = await localStore.list("fbp.profiles")
    if (profileKeys.length === 0 && !gistId) {
      await remote.set(
        "_fbp_init.json",
        JSON.stringify({
          created: new Date().toISOString(),
          note: "Factorio Blueprint Calculator sync gist — created automatically.",
        }),
      )
    }
    for (const k of profileKeys) {
      const v = await localStore.get(k)
      if (v != null) await remote.set(k, v)
    }
    if (!gistId) {
      const err = remote.lastWriteError
      setStatus({
        kind: "err",
        msg: err
          ? `Couldn't create gist — ${err.message}. Run Diagnose for a step-by-step check.`
          : "Couldn't create gist — check that the token has the 'gist' scope. Run Diagnose for details.",
      })
      return
    }

    // 2. Persist settings with the (possibly newly-minted) gist id.
    setSettings({
      backend: "gist",
      gist: { token, gistId },
    })
    setDraftGistId(gistId) // canonical display

    // 3. Pull remote → local so anything already in the gist becomes
    //    visible locally too (e.g. profiles synced from a different
    //    device).
    await refreshFromRemote("fbp.profiles")
    setStatus({
      kind: "ok",
      msg: `Synced ${profileKeys.length} key${profileKeys.length === 1 ? "" : "s"} to gist ${gistId.slice(0, 8)}…`,
    })
  }

  const statusColor =
    status?.kind === "ok"
      ? "rgba(125, 211, 252, 0.95)"
      : status?.kind === "err"
        ? "rgba(255, 107, 139, 0.95)"
        : LABEL

  return (
    <form
      data-testid="sync-settings"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
      style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}
    >
      <div
        style={{
          color: LABEL,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontSize: 10,
          paddingTop: 6,
          paddingBottom: 4,
          borderTop: `1px solid ${AMBER_FAINT}`,
        }}
      >
        Sync · active: {activeBackend}
      </div>
      {settings.backend === "gist" && settings.gist?.gistId && (
        <a
          href={`https://gist.github.com/${settings.gist.gistId}`}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="sync-gist-link"
          style={{ color: AMBER, fontSize: 10, textDecoration: "underline" }}
        >
          View gist on GitHub ↗
        </a>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ color: LABEL, fontSize: 10 }}>Backend</span>
        <select
          data-testid="sync-backend-select"
          value={draftBackend}
          onChange={(e) => setDraftBackend(e.target.value as StorageSettings["backend"])}
          style={FIELD_STYLE}
        >
          <option value="local">Local (this browser)</option>
          <option value="gist">GitHub Gist (cross-device)</option>
        </select>
      </label>

      {draftBackend === "gist" && (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ color: LABEL, fontSize: 10 }}>
              Personal access token (gist scope)
            </span>
            <input
              data-testid="sync-token-input"
              type="password"
              autoComplete="off"
              value={draftToken}
              onChange={(e) => setDraftToken(e.target.value)}
              placeholder="ghp_..."
              style={FIELD_STYLE}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ color: LABEL, fontSize: 10 }}>
              Gist id or URL (blank = auto-create)
            </span>
            <input
              data-testid="sync-gistid-input"
              autoComplete="off"
              value={draftGistId}
              onChange={(e) => setDraftGistId(e.target.value)}
              placeholder="leave blank — auto-created on first save"
              style={FIELD_STYLE}
            />
            <span style={{ color: LABEL, fontSize: 9, lineHeight: 1.4 }}>
              Gist ids are hex hashes (e.g. <code>1a2b3c4d…</code>), not
              names. Paste the gist URL and we'll extract the id; or
              just leave it blank — we'll create a private gist for you
              on first save and remember the id automatically.
            </span>
          </label>
          <div style={{ color: LABEL, fontSize: 10, lineHeight: 1.4 }}>
            Token is stored in localStorage on this device. Create one at{" "}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: AMBER }}
            >
              github.com/settings/tokens
            </a>{" "}
            with the <code>gist</code> scope only.
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          style={GHOST_BUTTON}
          data-testid="sync-test"
        >
          Test
        </button>
        <button
          type="button"
          onClick={onDiagnose}
          disabled={testing}
          style={GHOST_BUTTON}
          data-testid="sync-diagnose"
          title="Step-by-step health check: authenticate, scope check, write probe, cleanup"
        >
          Diagnose
        </button>
        <button
          type="submit"
          style={BUTTON_STYLE}
          data-testid="sync-save"
        >
          Save
        </button>
      </div>

      {status && (
        <div
          data-testid="sync-status"
          style={{ color: statusColor, fontSize: 10, paddingTop: 2 }}
        >
          {status.msg}
        </div>
      )}

      {diagnostics && (
        <div
          data-testid="sync-diagnostics"
          style={{
            border: `1px solid ${AMBER_FAINT}`,
            padding: "6px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 10,
            lineHeight: 1.4,
          }}
        >
          <div
            style={{
              color: LABEL,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              fontSize: 9,
              paddingBottom: 2,
            }}
          >
            Diagnostic steps
          </div>
          {diagnostics.steps.map((step, i) => (
            <div
              key={i}
              data-testid={`sync-diagnostic-step-${i}`}
              style={{ display: "flex", flexDirection: "column", gap: 1 }}
            >
              <div style={{ display: "flex", gap: 4 }}>
                <span
                  style={{
                    color: step.ok
                      ? "rgba(125, 211, 252, 0.95)"
                      : "rgba(255, 107, 139, 0.95)",
                    fontWeight: 700,
                    minWidth: 12,
                  }}
                >
                  {step.ok ? "✓" : "✗"}
                </span>
                <span style={{ flex: 1, color: "rgba(255,255,255,0.85)" }}>
                  {step.name}
                  {step.status != null && (
                    <span style={{ color: LABEL, marginLeft: 4 }}>
                      [{step.status}]
                    </span>
                  )}
                </span>
              </div>
              <div style={{ color: LABEL, paddingLeft: 16 }}>{step.message}</div>
              {step.bodyPreview && (
                <pre
                  style={{
                    color: "rgba(255, 107, 139, 0.8)",
                    fontSize: 9,
                    paddingLeft: 16,
                    margin: 0,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {step.bodyPreview}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </form>
  )
}
