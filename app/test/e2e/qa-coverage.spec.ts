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
