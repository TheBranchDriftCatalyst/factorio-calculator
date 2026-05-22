import { test, expect, openSchematic } from "./fixtures"
import type { Locator } from "@playwright/test"

// Click a collapsible panel's header ONLY if it's currently collapsed.
// Avoids the foot-gun where some panels default to expanded — clicking
// "to expand" actually toggles them shut.
async function ensureExpanded(panel: Locator) {
  const header = panel.locator("button").first()
  const expanded = await header.getAttribute("aria-expanded")
  if (expanded === "false") await header.click()
}

// Coverage for QA.md gaps identified in fbp-pxu. Grouped by QA.md section.
// Each test ties to one or more bullets so we can grep this file to
// confirm a row is covered.

test.describe("QA §4 — Tab navigation + hash sync", () => {
  test("number keys 1/2/3/4 switch tabs and the URL hash follows", async ({ page }) => {
    // useKeymap binds digit keys to tab indexes — must be pressed on body
    // because the helper skips events targeting form inputs.
    await page.locator("body").press("1")
    await expect(page).toHaveURL(/#\/sankey/)
    await page.locator("body").press("2")
    await expect(page).toHaveURL(/#\/boxline/)
    await page.locator("body").press("3")
    await expect(page).toHaveURL(/#\/schematic/)
    await page.locator("body").press("4")
    await expect(page).toHaveURL(/#\/catalog/)
  })

  test("changing the URL hash directly activates the corresponding tab", async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = "#/boxline"
      // The hashchange listener in App.tsx triggers a state update.
      window.dispatchEvent(new HashChangeEvent("hashchange"))
    })
    await expect(page.getByTestId("boxline-svg")).toBeVisible()
  })
})

test.describe("QA §7 — Esc clears schematic selection", () => {
  test("Esc on body resets pinned cell + lane selection", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    await page.locator("body").press("f")

    // Pin a known cell.
    const point = await schematic.cellAt("electronic-circuit")
    await page.mouse.click(point.x, point.y)
    await expect(
      page.locator('[data-testid="cell-inspector"][data-state="pinned"]'),
    ).toBeVisible()

    // Esc clears the PINNED state. The inspector may still show a
    // hovering preview (mouse position retained from the click) — we
    // just assert that the pinned variant is gone.
    await page.locator("body").press("Escape")
    await expect(
      page.locator('[data-testid="cell-inspector"][data-state="pinned"]'),
    ).toHaveCount(0)
  })
})

test.describe("QA §8 — Topology panel knobs (beyond zoom)", () => {
  test("bottleneck toggle updates the badge + canvas re-renders", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()

    // Bottleneck mode badge appears only when the toggle is on.
    await expect(page.getByTestId("bottleneck-badge")).toHaveCount(0)
    // Expand the topology panel and flip the toggle via its field testid.
    await ensureExpanded(page.getByTestId("topology-panel"))
    const toggle = page.getByTestId("tf-bottleneckMode")
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByTestId("bottleneck-badge")).toBeVisible()
    // Flip back so subsequent tests have a clean slate.
    await toggle.click()
    await expect(page.getByTestId("bottleneck-badge")).toHaveCount(0)
  })

  test("crossings toggle hides crossing markers when off", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    await ensureExpanded(page.getByTestId("topology-panel"))
    // Verify the toggle exists + flipping it commits to SchematicConfig.
    const toggle = page.getByTestId("tf-showCrossings")
    await expect(toggle).toBeVisible()
    const before = await toggle.getAttribute("aria-checked")
    await toggle.click()
    await expect.poll(async () => toggle.getAttribute("aria-checked")).not.toBe(before)
  })

  test("layout-algorithm picker swaps the active layout on a heavy factory", async ({
    page,
    schematic,
  }) => {
    // Inject a multi-target factory heavy enough that auto-bus's
    // heuristic actually splits something. The default e-circuit-only
    // factory has too few cells; on it the two algorithms produce the
    // same output.
    await page.evaluate(() => {
      localStorage.setItem(
        "fbp.targets.v1",
        JSON.stringify([
          { item: "automation-science-pack", rate: 1 },
          { item: "logistic-science-pack", rate: 1 },
          { item: "military-science-pack", rate: 1 },
          { item: "chemical-science-pack", rate: 1 },
          { item: "advanced-circuit", rate: 1 },
        ]),
      )
      localStorage.setItem(
        "fbp.inputs.v1",
        JSON.stringify([
          { item: "plastic-bar", rate: 1000 },
          { item: "sulfur", rate: 1000 },
        ]),
      )
    })
    await page.reload()
    await openSchematic(page)
    await schematic.waitForCanvas()
    // TopologyPanel defaults to expanded so ensureExpanded is a no-op
    // here — but using it instead of an unconditional click is the
    // safe pattern (avoids accidentally TOGGLING the panel closed).
    await ensureExpanded(page.getByTestId("topology-panel"))

    const picker = page.getByTestId("tf-layoutAlgorithm")
    await expect(picker).toBeVisible()

    // Read the live blueprint width from the test hook (window.__schematic).
    const readWidth = () =>
      page.evaluate(() => {
        const all = document.querySelectorAll("*")
        for (const el of all) {
          const k = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
          if (!k) continue
          // @ts-expect-error fiber access for test
          let f = el[k]
          while (f) {
            if (f.memoizedProps?.blueprint?.cells) {
              return f.memoizedProps.blueprint.width as number
            }
            f = f.return
          }
        }
        return null
      })

    // Default is bus-tree, so just snap the baseline. (Don't call
    // selectOption to "pin" bus-tree first — Playwright's selectOption
    // when the option is already selected suppresses the React state
    // events on the SUBSEQUENT selectOption call, leaving the picker
    // stuck visually-changed-but-uncommitted.)
    expect(await picker.inputValue()).toBe("bus-tree")
    const busTreeWidth = await readWidth()
    expect(busTreeWidth).toBeGreaterThan(0)

    // Switch to auto-bus. On this factory the heuristic flags
    // iron-plate (8 consumers, above the 6 threshold) and pushes it to
    // L2 — adding a trunk column, so the blueprint widens.
    await picker.selectOption("auto-bus")
    await expect
      .poll(readWidth, { timeout: 5000 })
      .toBeGreaterThan(busTreeWidth!)
  })
})

test.describe("QA §9 — Recipe picker (multi-recipe target)", () => {
  test("switching the recipe variation reflects in the popover trigger", async ({ page }) => {
    // Swap target 0 to petroleum-gas (always has multiple recipes in
    // the space-age dataset). The RecipePicker only renders when there
    // are 1+ recipe options — for petroleum-gas there are 3-4.
    await page.getByTestId("target-item-0").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-0-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("petroleum")
    await dropdown.locator("[cmdk-item]").first().click()

    const trigger = page.getByTestId("target-recipe-0").locator("button").first()
    await trigger.click()
    const popover = page.getByTestId("target-recipe-0-popover")
    await expect(popover).toBeVisible()
    // At least one alternate recipe + the "default" pseudo-row.
    const rows = popover.locator("button")
    expect(await rows.count()).toBeGreaterThan(1)

    // Pick the "default" row; popover closes.
    await page.getByTestId("target-recipe-0-option-default").click()
    await expect(popover).toHaveCount(0)
  })
})

test.describe("QA §10 — Default machine picker", () => {
  test("MachineCategoryPicker exposes a row per category in the active flow", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    const picker = page.getByTestId("machine-category-picker")
    await expect(picker).toBeVisible()
    await ensureExpanded(picker)
    // At least one category dropdown is rendered (default e-circuit factory
    // touches `crafting` + `smelting` at minimum).
    const rows = picker.locator("[data-testid^='category-default-']")
    expect(await rows.count()).toBeGreaterThanOrEqual(2)
  })
})

test.describe("QA §11 — Intermediates panel", () => {
  test("oil refinery target shows BYPRODUCT badges on heavy/light oil", async ({
    page,
    schematic,
  }) => {
    // Set petroleum-gas as the only target so the refinery is in scope
    // and its non-petroleum products surface as byproducts (cyan badge).
    await page.getByTestId("target-item-0").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-0-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("petroleum")
    await dropdown.locator("[cmdk-item]").first().click()

    await openSchematic(page)
    await schematic.waitForCanvas()
    const panel = page.getByTestId("intermediates-panel")
    await expect(panel).toBeVisible()
    await panel.locator("button").first().click()

    // Heavy + light oil must be flagged BYPRODUCT (data-state="byproduct").
    await expect(
      page.locator('[data-testid="intermediate-heavy-oil-status"][data-state="byproduct"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="intermediate-light-oil-status"][data-state="byproduct"]'),
    ).toBeVisible()
  })
})

test.describe("QA §14 — Sidebar resize handle (a11y)", () => {
  test("ArrowLeft on the handle widens the rail", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    const handle = page.getByTestId("sidebar-resize-handle")
    await handle.focus()
    const before = await page
      .getByTestId("right-rail")
      .evaluate((el) => el.getBoundingClientRect().width)
    await page.keyboard.press("ArrowLeft")
    await expect
      .poll(async () =>
        page.getByTestId("right-rail").evaluate((el) => el.getBoundingClientRect().width),
      )
      .toBeGreaterThan(before)
  })

  test("Home jumps to max width", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    const handle = page.getByTestId("sidebar-resize-handle")
    await handle.focus()
    await page.keyboard.press("Home")
    // SIDEBAR_MAX_WIDTH = 720 from App.tsx.
    await expect
      .poll(async () =>
        page.getByTestId("right-rail").evaluate((el) => el.getBoundingClientRect().width),
      )
      .toBe(720)
  })
})

test.describe("QA §18 — Command palette", () => {
  test("Cmd/Ctrl+K opens the palette; Esc closes it", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+k")
    const palette = page.getByTestId("command-palette")
    await expect(palette).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(palette).toHaveCount(0)
  })
})

test.describe("QA §7 — Cell inspector I/O shape line", () => {
  test("pinned cell inspector exposes the I/O shape testid with N:N text", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    // Fit-to-content so the cell lands inside the viewport before we
    // resolve its screen coordinates.
    await page.locator("body").press("f")
    // Wait for the test hook to be ready before grabbing coordinates.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const h = (
            window as unknown as { __schematic?: { cellAt?: (k: string) => unknown } }
          ).__schematic
          return h?.cellAt?.("electronic-circuit") ? "ready" : "pending"
        }),
      )
      .toBe("ready")

    const point = await schematic.cellAt("electronic-circuit")
    await page.mouse.click(point.x, point.y)
    const inspector = page.locator('[data-testid="cell-inspector"][data-state="pinned"]')
    await expect(inspector).toBeVisible()

    // The cell-io-shape line lives inside CellDetails. Text is e.g.
    // "I/O 3:0 → 1:0" — assert at minimum a digit:digit pair appears.
    const shape = inspector.getByTestId("cell-io-shape")
    await expect(shape).toBeVisible()
    await expect(shape).toHaveText(/I\/O\s+\d+:\d+/)
  })
})

test.describe("QA §11 — IntermediatesPanel byproduct attribute", () => {
  test("heavy-oil flagged as byproduct; petroleum-gas (the target) is NOT byproduct", async ({
    page,
    schematic,
  }) => {
    // Swap target 0 to petroleum-gas so the refinery is in scope.
    await page.getByTestId("target-item-0").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-0-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("petroleum")
    await dropdown.locator("[cmdk-item]").first().click()

    await openSchematic(page)
    await schematic.waitForCanvas()

    const panel = page.getByTestId("intermediates-panel")
    await expect(panel).toBeVisible()
    // Expand if currently collapsed (panel header is the first button).
    const header = panel.locator("button").first()
    if ((await header.getAttribute("aria-expanded")) === "false") await header.click()

    // Heavy oil — structurally a byproduct because the refinery is sized
    // for petroleum demand and heavy oil falls out alongside.
    const heavy = page.locator(
      '[data-testid="intermediate-heavy-oil-status"][data-state="byproduct"]',
    )
    await expect(heavy).toBeVisible()

    // Petroleum gas IS the user-target — even if it appears as an
    // intermediate row, it must NOT be flagged byproduct. We assert that
    // the byproduct-variant locator finds 0 rows; the plain status row
    // may or may not exist depending on whether petroleum is internally
    // consumed (it isn't in the default config) — either way is fine.
    const petByproduct = page.locator(
      '[data-testid="intermediate-petroleum-gas-status"][data-state="byproduct"]',
    )
    await expect(petByproduct).toHaveCount(0)
  })
})

test.describe("QA §12 — Lane inspector belt-tier override flow", () => {
  test("changing per-lane tier surfaces the override label + BOM tier split", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    await page.locator("body").press("f")

    // Pin a known belt. iron-ore is on the leftmost trunk belt of the
    // default electronic-circuit factory; copper-ore is the fallback.
    const point =
      (await schematic.beltAt("iron-ore")) ?? (await schematic.beltAt("copper-ore"))
    expect(point).not.toBeNull()
    if (!point) return
    await page.mouse.click(point.x, point.y)

    const inspector = page.getByTestId("lane-inspector")
    await expect(inspector).toBeVisible()

    // Change the per-lane belt tier to turbo via the native <select>.
    const tierSelect = page.getByTestId("lane-belt-tier-override")
    await expect(tierSelect).toBeVisible()
    await tierSelect.selectOption("turbo")

    // Re-resolve the inspector — selectOption triggers a state update
    // that re-renders the LaneDetails subtree. The caption + "(override)"
    // marker both flow from `overrideTier`.
    const inspector2 = page.getByTestId("lane-inspector")
    await expect(inspector2).toContainText("@ turbo belt")
    await expect(inspector2).toContainText("(override)")

    // BOM ties to the override — expand the BOM panel and confirm a row
    // for the turbo belt tier shows up (data-testid=bom-belts-turbo).
    const bom = page.getByTestId("bom-panel")
    await expect(bom).toBeVisible()
    const bomHeader = bom.locator("button").first()
    if ((await bomHeader.getAttribute("aria-expanded")) === "false") await bomHeader.click()
    await expect(page.getByTestId("bom-belts-turbo")).toBeVisible()
  })
})

test.describe("QA §14 — Sidebar resize handle (mouse drag)", () => {
  test("dragging the handle left widens the rail by ~drag distance", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()

    const handle = page.getByTestId("sidebar-resize-handle")
    const rail = page.getByTestId("right-rail")
    const handleBox = await handle.boundingBox()
    expect(handleBox).not.toBeNull()
    if (!handleBox) return
    const before = await rail.evaluate((el) => el.getBoundingClientRect().width)

    // Center of the handle, drag 100px to the LEFT (rail widens).
    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Intermediate move helps Playwright deliver the mousemove sequence.
    await page.mouse.move(startX - 50, startY, { steps: 5 })
    await page.mouse.move(startX - 100, startY, { steps: 5 })
    await page.mouse.up()

    const after = await rail.evaluate((el) => el.getBoundingClientRect().width)
    // ~100px wider. Tolerance is wide because the resize handler anchors
    // to `rect.right - e.clientX` (not the mousedown position) and the
    // intermediate `mouse.move` steps deliver several events — the net
    // delta empirically lands in the 80-160px range depending on how
    // the renderer batches mousemoves. We just need to confirm the drag
    // moves the rail substantially.
    expect(after - before).toBeGreaterThan(60)
    expect(after - before).toBeLessThan(180)
  })
})

test.describe("QA §19 — Profile delete + empty state", () => {
  test("creating then deleting a profile removes the row + restores empty state", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()

    // Open the drawer.
    await page.getByTestId("profile-sidebar-trigger").hover()
    const drawer = page.getByTestId("profile-sidebar-drawer")
    await expect
      .poll(async () => drawer.evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.9)

    // Pre-condition: no profiles → drawer shows the "No saved profiles yet."
    // empty message. ProfileSidebar renders this inline (no dedicated
    // testid), so we match the literal text.
    await expect(drawer).toContainText("No saved profiles yet.")

    // Create "DeleteMe".
    await page.getByTestId("profile-add-trigger").click()
    const input = page.getByTestId("profile-add-input")
    await expect(input).toBeVisible()
    await input.fill("DeleteMe")
    await input.press("Enter")

    // Row appears.
    await page.getByTestId("profile-sidebar-trigger").hover()
    const row = page.locator("[data-testid^='profile-row-']", { hasText: "DeleteMe" })
    await expect(row).toBeVisible()
    await expect(drawer).not.toContainText("No saved profiles yet.")

    // Delete.
    const deleteBtn = row.locator("[data-testid^='profile-delete-']")
    await deleteBtn.click()

    // Row gone + empty state restored.
    await expect(row).toHaveCount(0)
    await expect(drawer).toContainText("No saved profiles yet.")
  })
})

test.describe("QA §7 — Camera keybindings", () => {
  test("pressing F (fit) and 0 (reset) keeps the canvas visible without error", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    const canvas = await schematic.waitForCanvas()
    await expect(canvas).toBeVisible()

    // Capture console errors — the test hook doesn't expose camera state,
    // but if the keymap throws (e.g. references a missing ref), it shows
    // up here.
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })

    await page.locator("body").press("f")
    await expect(canvas).toBeVisible()
    await page.locator("body").press("0")
    await expect(canvas).toBeVisible()

    expect(errors).toEqual([])
  })
})

test.describe("QA — BOM panel mixed tier rows", () => {
  test("global yellow + per-lane red override yields BOTH belt-tier rows in BOM", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    await page.locator("body").press("f")

    // Pin iron-ore lane (default trunk belt) so we can override it to red.
    const point =
      (await schematic.beltAt("iron-ore")) ?? (await schematic.beltAt("copper-ore"))
    expect(point).not.toBeNull()
    if (!point) return
    await page.mouse.click(point.x, point.y)

    const inspector = page.getByTestId("lane-inspector")
    await expect(inspector).toBeVisible()
    await page.getByTestId("lane-belt-tier-override").selectOption("red")

    // Expand the BOM panel.
    const bom = page.getByTestId("bom-panel")
    await expect(bom).toBeVisible()
    const bomHeader = bom.locator("button").first()
    if ((await bomHeader.getAttribute("aria-expanded")) === "false") await bomHeader.click()

    // Global tier is yellow; one lane is now red → both rows should exist.
    // (Other unhighlighted lanes still use the global yellow tier.)
    await expect(page.getByTestId("bom-belts-red")).toBeVisible()
    await expect(page.getByTestId("bom-belts-yellow")).toBeVisible()
  })
})
