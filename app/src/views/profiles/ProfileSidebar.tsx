import { useCallback, useEffect, useRef, useState } from "react"
import type { Input, Target } from "../../solver/expand"
import {
  deleteProfile,
  listProfiles,
  nextProfileName,
  saveProfile,
  type Profile,
} from "./profileStore"

interface Props {
  currentTargets: Target[]
  currentInputs: Input[]
  onLoad: (targets: Target[], inputs: Input[]) => void
}

// Bloomberg-inspired palette. Pulled from the rest of the app so the drawer
// visually belongs to the same UI family.
const AMBER = "#FFB000"
const AMBER_DIM = "rgba(255,176,0,0.35)"
const AMBER_FAINT = "rgba(255,176,0,0.18)"
const BG = "rgba(8,8,12,0.96)"
const LABEL = "rgba(255,255,255,0.45)"

const TRIGGER_WIDTH = 32
const DRAWER_WIDTH = 280

/**
 * Fixed-position left-edge drawer. A thin trigger strip is always visible;
 * hovering the strip OR the drawer slides the panel open. Internal state
 * (the saved profiles list) is kept locally — only `onLoad` propagates back
 * to App, so this component owns its localStorage I/O.
 */
export function ProfileSidebar({ currentTargets, currentInputs, onLoad }: Props) {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // Initial load + refresh-on-open so multi-tab edits don't go stale.
  useEffect(() => {
    setProfiles(listProfiles())
  }, [])
  useEffect(() => {
    if (open) setProfiles(listProfiles())
  }, [open])

  // Autofocus the inline input as soon as the add-row appears.
  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const beginAdd = useCallback(() => {
    setDraftName(nextProfileName())
    setAdding(true)
  }, [])

  const commitAdd = useCallback(() => {
    const created = saveProfile(draftName, currentTargets, currentInputs)
    setProfiles((p) => [...p, created])
    setAdding(false)
    setDraftName("")
  }, [draftName, currentTargets, currentInputs])

  const cancelAdd = useCallback(() => {
    setAdding(false)
    setDraftName("")
  }, [])

  const remove = useCallback((id: string) => {
    deleteProfile(id)
    setProfiles((p) => p.filter((x) => x.id !== id))
  }, [])

  return (
    <div
      data-testid="profile-sidebar-root"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: "100vh",
        width: open ? DRAWER_WIDTH : TRIGGER_WIDTH,
        zIndex: 100,
        transition: "width 150ms ease-out",
        display: "flex",
        flexDirection: "row",
        pointerEvents: "none",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false)
        // If user mouses out while the inline input is open, discard the draft
        // so reopening shows a fresh state.
        if (adding) cancelAdd()
      }}
    >
      {/* Trigger strip — visible even when drawer is closed. */}
      <div
        data-testid="profile-sidebar-trigger"
        style={{
          width: TRIGGER_WIDTH,
          height: "100%",
          background: BG,
          borderRight: `1px solid ${AMBER_DIM}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: AMBER,
          fontSize: 16,
          fontFamily:
            '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          pointerEvents: "auto",
          cursor: "pointer",
          userSelect: "none",
        }}
        aria-label="Profiles"
      >
        <span style={{ writingMode: "vertical-rl", letterSpacing: "0.2em" }}>
          ≡ PROFILES
        </span>
      </div>

      {/* Drawer panel — rendered only when open so it can't intercept clicks
          while collapsed (the trigger strip is enough). */}
      <div
        data-testid="profile-sidebar-drawer"
        style={{
          flex: 1,
          height: "100%",
          background: BG,
          borderRight: `1px solid ${AMBER_DIM}`,
          color: "rgba(255,255,255,0.85)",
          fontFamily:
            '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          padding: "12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflowY: "auto",
          opacity: open ? 1 : 0,
          transition: "opacity 150ms ease-out",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div
          style={{
            color: LABEL,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontSize: 10,
            paddingBottom: 4,
            borderBottom: `1px solid ${AMBER_FAINT}`,
          }}
        >
          Profiles
        </div>

        {!adding ? (
          <button
            data-testid="profile-add-trigger"
            onClick={beginAdd}
            style={{
              background: "transparent",
              border: `1px dashed ${AMBER_DIM}`,
              color: AMBER,
              padding: "6px 8px",
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              letterSpacing: "0.05em",
            }}
          >
            + Save current as profile
          </button>
        ) : (
          <div
            data-testid="profile-add-row"
            style={{ display: "flex", gap: 4, alignItems: "stretch" }}
          >
            <input
              ref={inputRef}
              data-testid="profile-add-input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAdd()
                if (e.key === "Escape") cancelAdd()
              }}
              placeholder="Profile name"
              style={{
                flex: 1,
                background: "rgba(0,0,0,0.4)",
                border: `1px solid ${AMBER_DIM}`,
                color: AMBER,
                padding: "4px 6px",
                fontFamily: "inherit",
                fontSize: 11,
                outline: "none",
              }}
            />
            <button
              data-testid="profile-add-confirm"
              onClick={commitAdd}
              style={{
                background: AMBER,
                color: "#0c0c10",
                border: "none",
                padding: "0 8px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              SAVE
            </button>
            <button
              data-testid="profile-add-cancel"
              onClick={cancelAdd}
              aria-label="Cancel"
              style={{
                background: "transparent",
                color: LABEL,
                border: `1px solid ${AMBER_FAINT}`,
                padding: "0 6px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
              }}
            >
              ×
            </button>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {profiles.length === 0 && (
            <div
              style={{
                color: LABEL,
                fontStyle: "italic",
                padding: "8px 4px",
                fontSize: 10.5,
              }}
            >
              No saved profiles yet.
            </div>
          )}
          {profiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              onLoad={() =>
                onLoad(
                  p.targets.map((t) => ({ ...t })),
                  (p.inputs ?? []).map((i) => ({ ...i })),
                )
              }
              onDelete={() => remove(p.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ProfileRow({
  profile,
  onLoad,
  onDelete,
}: {
  profile: Profile
  onLoad: () => void
  onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      data-testid={`profile-row-${profile.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        padding: "5px 6px",
        background: hover ? "rgba(255,176,0,0.08)" : "transparent",
        border: `1px solid ${hover ? AMBER_DIM : "transparent"}`,
        cursor: "pointer",
      }}
      onClick={onLoad}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            color: AMBER,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {profile.name}
        </span>
        <span style={{ color: LABEL, fontSize: 10 }}>
          {profile.targets.length} target{profile.targets.length === 1 ? "" : "s"}
        </span>
      </div>
      <button
        data-testid={`profile-delete-${profile.id}`}
        onClick={(e) => {
          // Stop propagation so the row's onClick (load) doesn't also fire.
          e.stopPropagation()
          onDelete()
        }}
        aria-label={`Delete ${profile.name}`}
        style={{
          background: "transparent",
          border: "none",
          color: LABEL,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 14,
          padding: "0 4px",
        }}
      >
        ×
      </button>
    </div>
  )
}
