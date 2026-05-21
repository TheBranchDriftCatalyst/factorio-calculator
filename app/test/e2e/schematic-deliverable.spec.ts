import { test, expect, type Page } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Schematic deliverable-quality coverage. Each test ends with a deterministic
// screenshot saved to test/e2e/__screenshots__/, intentionally not using
// toHaveScreenshot — we want human-reviewable artifacts, not pixel diffs.

const SHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__screenshots__")
const shot = (name: string) => path.join(SHOT_DIR, name)

// Wait until the canvas is mounted AND has been sized (drawing has happened
// at least once). Avoids racing with the dataset/solver pipeline. Uses
// Playwright's polling via a function locator instead of arbitrary sleeps.
async function waitForSchematicReady(page: Page) {
  const canvas = page.getByTestId("schematic-canvas")
  await expect(canvas).toBeVisible()
  await expect
    .poll(async () =>
      canvas.evaluate((c) => {
        const el = c as HTMLCanvasElement
        return el.width > 64 && el.height > 64
      }),
    )
    .toBe(true)
}

async function openSchematic(page: Page) {
  await page.goto("/")
  // Clear any leftover schematic config so each test gets a deterministic
  // starting point (default split layout, no overrides).
  await page.evaluate(() => {
    localStorage.removeItem("schematic.config.v1")
  })
  // Theme pinning copied from app.spec — keeps first paint deterministic.
  await page.addInitScript(() => {
    localStorage.setItem("theme:name", JSON.stringify("catalyst"))
    localStorage.setItem("theme:variant", JSON.stringify("dark"))
  })
  await page.reload()
  await page.getByTestId("tab-schematic").click()
  await waitForSchematicReady(page)
}

test.describe("Schematic — delivery quality", () => {
  test("default schematic renders all key elements", async ({ page }) => {
    await openSchematic(page)

    // Press `f` to fit-to-content. useKeymap skips inputs, so press on body.
    await page.locator("body").press("f")

    await expect(page.getByTestId("schematic-canvas")).toBeVisible()
    await expect(page.getByTestId("topology-panel")).toBeVisible()
    await expect(page.getByTestId("hud-strip")).toBeVisible()
    await expect(page.getByTestId("camera-hint")).toBeVisible()

    await page.screenshot({ path: shot("schematic-default.png"), fullPage: true })
  })

  test("split layout puts output bus on the right", async ({ page }) => {
    await openSchematic(page)

    // The segmented control's child buttons are `tf-outputBusSide-<opt>`.
    // The active one carries the amber-on-black active styling — check its
    // aria-less state via the rgba background. Easier: assert the "split"
    // button exists and has the active background color.
    const splitBtn = page.getByTestId("tf-outputBusSide-split")
    await expect(splitBtn).toBeVisible()
    const splitBg = await splitBtn.evaluate((el) => getComputedStyle(el).backgroundColor)
    // active background is rgba(255,201,64,0.85) per topologyFields.ts
    expect(splitBg).toBe("rgba(255, 201, 64, 0.85)")

    // Reset zoom — useKeymap maps "0" → reset.
    await page.locator("body").press("0")

    const canvas = page.getByTestId("schematic-canvas")
    // CSS width is set via canvas.style.width = `${blueprint.width * tilePx}px`.
    // Default tilePx is 18; we want at least 30 tiles wide.
    const cssWidth = await canvas.evaluate(
      (c) => (c as HTMLCanvasElement).getBoundingClientRect().width,
    )
    expect(cssWidth).toBeGreaterThanOrEqual(30 * 18)

    await page.screenshot({ path: shot("split-layout.png"), fullPage: true })
  })

  test("belt vs pipe visual distinction", async ({ page }) => {
    await openSchematic(page)

    // Try to swap the first target's item to a fluid (petroleum-gas if it
    // exists in the dataset). If the combobox can't find it, fall back to
    // the default circuit pipeline — we still get a visual baseline.
    await page.getByTestId("target-item-0").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-0-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("petroleum")
    const items = dropdown.locator("[cmdk-item]")
    const itemCount = await items.count()
    if (itemCount > 0) {
      await items.first().click()
    } else {
      // Close the dropdown without changing the item.
      await page.keyboard.press("Escape")
    }

    await waitForSchematicReady(page)
    // Allow a re-render after item change.
    await expect.poll(async () =>
      page.getByTestId("schematic-canvas").evaluate(
        (c) => (c as HTMLCanvasElement).width,
      ),
    ).toBeGreaterThan(64)

    const canvas = page.getByTestId("schematic-canvas")
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      await page.screenshot({
        path: shot("pipes-vs-belts.png"),
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      })
    }
  })

  test("clicking a cell pins its details", async ({ page }) => {
    await openSchematic(page)

    const canvas = page.getByTestId("schematic-canvas")
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    // Find a cell by reading the canvas size and clicking the middle — the
    // default electronic-circuit blueprint always lays out cells across the
    // canvas. We try a grid of candidate points until the inspector flips
    // from empty to populated, so we're robust to small layout differences.
    const candidates = [
      [0.5, 0.5],
      [0.6, 0.5],
      [0.4, 0.6],
      [0.5, 0.7],
      [0.3, 0.4],
      [0.7, 0.4],
      [0.4, 0.5],
      [0.6, 0.6],
      [0.5, 0.4],
      [0.55, 0.55],
    ] as const

    let pinned = false
    for (const [fx, fy] of candidates) {
      const x = box.x + box.width * fx
      const y = box.y + box.height * fy
      await page.mouse.click(x, y)
      // Inspector body switches to data-testid="cell-inspector" when a cell
      // is selected (vs `cell-inspector-empty` initially).
      const inspector = page.getByTestId("cell-inspector")
      if (await inspector.isVisible().catch(() => false)) {
        const text = (await inspector.textContent()) ?? ""
        if (text.trim().length > 0 && /pinned/i.test(text)) {
          pinned = true
          break
        }
      }
    }

    expect(pinned).toBe(true)
    const inspector = page.getByTestId("cell-inspector")
    const text = (await inspector.textContent()) ?? ""
    // Recipe name + machine count (`×N`) should appear in CellDetails.
    expect(text).toMatch(/×\s*\d/)

    await page.screenshot({ path: shot("cell-pinned.png"), fullPage: true })
  })

  test("clicking a lane shows belt details", async ({ page }) => {
    await openSchematic(page)

    const canvas = page.getByTestId("schematic-canvas")
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    // Belt columns live near the left/right edges (split layout) and between
    // groups. Sweep along a vertical strip near the left edge first, then
    // walk a few horizontal columns. The lane hit-test only fires when the
    // click misses every cell, so we deliberately try thin strips.
    const probes: Array<readonly [number, number]> = []
    for (const fx of [0.02, 0.05, 0.08, 0.95, 0.92, 0.5, 0.4, 0.6, 0.3]) {
      for (const fy of [0.3, 0.5, 0.7]) {
        probes.push([fx, fy] as const)
      }
    }

    let laneShown = false
    for (const [fx, fy] of probes) {
      const x = box.x + box.width * fx
      const y = box.y + box.height * fy
      await page.mouse.click(x, y)
      const laneInspector = page.getByTestId("lane-inspector")
      if (await laneInspector.isVisible().catch(() => false)) {
        laneShown = true
        break
      }
    }

    expect(laneShown).toBe(true)
    const inspector = page.getByTestId("lane-inspector")
    const text = (await inspector.textContent()) ?? ""
    // Rate string ends in /s, /min, or /hr per fmtRateUnit.
    expect(text).toMatch(/\/(s|min|hr)\b/)
    // The first item is the item name — non-empty.
    expect(text.trim().length).toBeGreaterThan(0)

    await page.screenshot({ path: shot("lane-pinned.png"), fullPage: true })
  })

  test("profile save and load roundtrip", async ({ page }) => {
    await openSchematic(page)

    // Clear any leftover profiles so the assertion isn't polluted across runs.
    await page.evaluate(() => {
      // The store uses its own key; clear permissively.
      for (const k of Object.keys(localStorage)) {
        if (/profile/i.test(k)) localStorage.removeItem(k)
      }
    })
    await page.reload()
    await page.getByTestId("tab-schematic").click()
    await waitForSchematicReady(page)

    // Hover the always-visible trigger strip to open the drawer.
    await page.getByTestId("profile-sidebar-trigger").hover()
    const drawer = page.getByTestId("profile-sidebar-drawer")
    // The drawer is always in DOM; opacity transitions to 1 when open.
    await expect.poll(async () =>
      drawer.evaluate((el) => Number(getComputedStyle(el).opacity)),
    ).toBeGreaterThan(0.9)

    await page.getByTestId("profile-add-trigger").click()
    const input = page.getByTestId("profile-add-input")
    await expect(input).toBeVisible()
    await input.fill("TestProfile")
    await input.press("Enter")

    // Re-hover to keep drawer open after the input commits.
    await page.getByTestId("profile-sidebar-trigger").hover()

    const newRow = page.locator("[data-testid^='profile-row-']", {
      hasText: "TestProfile",
    })
    await expect(newRow).toBeVisible()

    // Reload and verify the profile persists.
    await page.reload()
    await page.getByTestId("profile-sidebar-trigger").hover()
    const persistedRow = page.locator("[data-testid^='profile-row-']", {
      hasText: "TestProfile",
    })
    await expect(persistedRow).toBeVisible()

    await page.screenshot({ path: shot("profile-saved.png"), fullPage: true })

    // Cleanup: click the delete button on this row.
    const deleteBtn = persistedRow.locator("[data-testid^='profile-delete-']")
    await deleteBtn.click()
    await expect(persistedRow).toHaveCount(0)
  })

  test("rate unit per-row toggle", async ({ page }) => {
    await openSchematic(page)

    const rateInput = page.getByTestId("target-rate-0")
    await expect(rateInput).toBeVisible()
    const beforeStr = await rateInput.inputValue()
    const before = Number(beforeStr)
    expect(Number.isFinite(before)).toBe(true)

    await page.getByTestId("target-rate-unit-0-min").click()

    // The displayed draft should be ~before * 60 (floating-point tolerant).
    await expect
      .poll(async () => Number(await rateInput.inputValue()))
      .toBeCloseTo(before * 60, 5)

    await page.screenshot({ path: shot("rate-unit-per-min.png"), fullPage: true })

    // Restore /s so we don't pollute subsequent tests' state (localStorage
    // doesn't persist the rate unit per row, but be tidy).
    await page.getByTestId("target-rate-unit-0-sec").click()
  })

  test("bottleneck mode color shift", async ({ page }) => {
    await openSchematic(page)

    // Press B on body to flip bottleneck mode on.
    await page.locator("body").press("b")
    await expect(page.getByTestId("bottleneck-badge")).toBeVisible()

    await page.screenshot({ path: shot("bottleneck-mode.png"), fullPage: true })

    // Toggle off so the next test starts clean.
    await page.locator("body").press("b")
    await expect(page.getByTestId("bottleneck-badge")).toHaveCount(0)
  })
})
