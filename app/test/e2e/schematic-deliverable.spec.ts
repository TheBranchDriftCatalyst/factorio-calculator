import { test, expect, shot, openSchematic } from "./fixtures"

// Schematic deliverable-quality coverage. Each test ends with a deterministic
// screenshot saved to test/e2e/_artifacts/, intentionally not using
// toHaveScreenshot — we want human-reviewable artifacts, not pixel diffs.

test.describe("Schematic — delivery quality", () => {
  test("default schematic renders all key elements", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    await page.locator("body").press("f")

    await expect(page.getByTestId("schematic-canvas")).toBeVisible()
    await expect(page.getByTestId("topology-panel")).toBeVisible()
    await expect(page.getByTestId("hud-strip")).toBeVisible()
    await expect(page.getByTestId("camera-hint")).toBeVisible()

    await page.screenshot({ path: shot("schematic-default.png"), fullPage: true })
  })

  test("split layout places at least one output to the right of cells", async ({
    page,
    schematic,
  }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()

    // Assert SEMANTIC layout, not button color. Walk the blueprint via the
    // test hook and confirm there's at least one belt whose x is to the
    // RIGHT of the rightmost cell — that's the "split" signature. The
    // blueprint exposes a recursive bus tree (`root`); trunk belts live
    // on the root node.
    const layout = await page.evaluate(() => {
      const hook = (
        window as unknown as {
          __schematic?: {
            blueprint?: {
              root?: { belts?: Array<{ x: number }> } | null
              cells?: Array<{ x: number; w: number }>
            }
          }
        }
      ).__schematic
      const bp = hook?.blueprint
      const belts = bp?.root?.belts
      if (!belts || !bp?.cells || bp.cells.length === 0) return null
      const maxCellRight = Math.max(...bp.cells.map((c) => c.x + c.w))
      const beltsRightOfCells = belts.filter((b) => b.x >= maxCellRight).length
      return { maxCellRight, beltsRightOfCells }
    })
    expect(layout).not.toBeNull()
    expect(layout!.beltsRightOfCells).toBeGreaterThan(0)

    await page.locator("body").press("0")
    await page.screenshot({ path: shot("split-layout.png"), fullPage: true })
  })

  test("belt vs pipe visual distinction (fluid-routed target)", async ({ page, schematic }) => {
    await openSchematic(page)

    // Swap target 0 to petroleum-gas (a fluid). If the dataset doesn't
    // surface it, FAIL THE TEST — we no longer silently pass a noop.
    await page.getByTestId("target-item-0").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-0-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("petroleum")
    const items = dropdown.locator("[cmdk-item]")
    await expect(items.first()).toBeVisible()
    expect(await items.count()).toBeGreaterThan(0)
    await items.first().click()

    const canvas = await schematic.waitForCanvas()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      await page.screenshot({
        path: shot("pipes-vs-belts.png"),
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      })
    }
  })

  test("clicking a known cell pins its details", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    // Fit-to-content so the cell lands inside the viewport before we
    // resolve its screen coordinates.
    await page.locator("body").press("f")
    // Tiny settle for camera state to flow into the test hook's effect.
    await expect.poll(async () =>
      page.evaluate(() => {
        const h = (window as unknown as { __schematic?: { cellAt?: (k: string) => unknown } })
          .__schematic
        return h?.cellAt?.("electronic-circuit") ? "ready" : "pending"
      }),
    ).toBe("ready")

    const point = await schematic.cellAt("electronic-circuit")
    await page.mouse.click(point.x, point.y)

    // Use the state attribute, not text matching.
    const inspector = page.locator('[data-testid="cell-inspector"][data-state="pinned"]')
    await expect(inspector).toBeVisible()
    const text = (await inspector.textContent()) ?? ""
    // Recipe name + machine count (`×N`) should appear in CellDetails.
    expect(text).toMatch(/×\s*\d/)

    await page.screenshot({ path: shot("cell-pinned.png"), fullPage: true })
  })

  test("clicking a known lane shows belt details", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()
    await page.locator("body").press("f")

    // iron-ore is always on the leftmost trunk belt for the default
    // electronic-circuit factory (shared between iron-plate and copper-plate
    // smelting chains in the sub-bus parent). Falls back to copper-ore which
    // sits on the same trunk belt's other sub-lane.
    const point = (await schematic.beltAt("iron-ore")) ?? (await schematic.beltAt("copper-ore"))
    expect(point).not.toBeNull()
    if (!point) return
    await page.mouse.click(point.x, point.y)

    const inspector = page.getByTestId("lane-inspector")
    await expect(inspector).toBeVisible()
    const text = (await inspector.textContent()) ?? ""
    expect(text).toMatch(/\/(s|min|hr)\b/)
    expect(text.trim().length).toBeGreaterThan(0)

    await page.screenshot({ path: shot("lane-pinned.png"), fullPage: true })
  })

  test("profile save and load roundtrip", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()

    await page.getByTestId("profile-sidebar-trigger").hover()
    const drawer = page.getByTestId("profile-sidebar-drawer")
    await expect.poll(async () =>
      drawer.evaluate((el) => Number(getComputedStyle(el).opacity)),
    ).toBeGreaterThan(0.9)

    await page.getByTestId("profile-add-trigger").click()
    const input = page.getByTestId("profile-add-input")
    await expect(input).toBeVisible()
    await input.fill("TestProfile")
    await input.press("Enter")

    await page.getByTestId("profile-sidebar-trigger").hover()
    const newRow = page.locator("[data-testid^='profile-row-']", { hasText: "TestProfile" })
    await expect(newRow).toBeVisible()

    await page.reload()
    await page.getByTestId("profile-sidebar-trigger").hover()
    const persistedRow = page.locator("[data-testid^='profile-row-']", {
      hasText: "TestProfile",
    })
    await expect(persistedRow).toBeVisible()

    await page.screenshot({ path: shot("profile-saved.png"), fullPage: true })

    // Cleanup so the row doesn't leak through `ready`'s storage clear (the
    // fixture clears before each test, but extra hygiene is cheap).
    const deleteBtn = persistedRow.locator("[data-testid^='profile-delete-']")
    await deleteBtn.click()
    await expect(persistedRow).toHaveCount(0)
  })

  test("rate unit per-row toggle", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()

    const rateInput = page.getByTestId("target-rate-0")
    await expect(rateInput).toBeVisible()
    const beforeStr = await rateInput.inputValue()
    const before = Number(beforeStr)
    expect(Number.isFinite(before)).toBe(true)

    await page.getByTestId("target-rate-unit-0-min").click()
    await expect
      .poll(async () => Number(await rateInput.inputValue()))
      .toBeCloseTo(before * 60, 5)

    await page.screenshot({ path: shot("rate-unit-per-min.png"), fullPage: true })

    await page.getByTestId("target-rate-unit-0-sec").click()
  })

  test("bottleneck mode color shift", async ({ page, schematic }) => {
    await openSchematic(page)
    await schematic.waitForCanvas()

    await page.locator("body").press("b")
    await expect(page.getByTestId("bottleneck-badge")).toBeVisible()

    await page.screenshot({ path: shot("bottleneck-mode.png"), fullPage: true })

    await page.locator("body").press("b")
    await expect(page.getByTestId("bottleneck-badge")).toHaveCount(0)
  })
})
