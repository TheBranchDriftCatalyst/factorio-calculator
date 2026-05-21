import { test, expect } from "./fixtures"

test.describe("Factorio Blueprint Calculator — happy path", () => {
  test("boots into dark catalyst theme", async ({ page }) => {
    await expect(page.locator("html")).toHaveClass(/theme-catalyst/)
    await expect(page.locator("html")).toHaveClass(/dark/)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    // catalyst dark --background is #0a0a0f → rgb(10, 10, 15)
    expect(bg).toBe("rgb(10, 10, 15)")
  })

  test("loads the catalog and shows default flow stats", async ({ page }) => {
    await expect(page.getByTestId("flow-stats")).toBeVisible()
    const stats = await page.getByTestId("flow-stats").textContent()
    expect(stats).toMatch(/\d+ nodes · \d+ flows · \d+\.\d+ MW/)
  })

  test("renders the sankey diagram with link rate labels", async ({ page }) => {
    await page.getByTestId("tab-sankey").click()
    const svg = page.getByTestId("sankey-svg")
    await expect(svg).toBeVisible()
    expect(await svg.locator("rect").count()).toBeGreaterThan(2)
    expect(await svg.locator("path").count()).toBeGreaterThan(1)
    const labelTexts = await svg.locator("text").allTextContents()
    expect(labelTexts.some((t) => /\d+\.\d+\/s/.test(t))).toBe(true)
  })

  test("renders the boxline diagram with orientation toggle", async ({ page }) => {
    await page.getByTestId("tab-boxline").click()
    const svg = page.getByTestId("boxline-svg")
    await expect(svg).toBeVisible()
    await page.getByTestId("boxline-orient-tb").click()
    await expect(svg).toBeVisible()
    await page.getByTestId("boxline-orient-lr").click()
    await expect(svg).toBeVisible()
  })

  test("renders the catalog summary tab", async ({ page }) => {
    await page.getByTestId("tab-catalog").click()
    const sum = page.getByTestId("catalog-summary")
    await expect(sum).toBeVisible()
    const rows = await sum.locator("tr").allTextContents()
    const itemsRow = rows.find((r) => r.startsWith("items"))
    expect(itemsRow).toMatch(/items\s*\d{3}/)
  })

  test("supports adding a second target and stats update", async ({ page }) => {
    const statsBefore = await page.getByTestId("flow-stats").textContent()

    await page.getByTestId("target-add").click()
    await expect(page.getByTestId("target-row-1")).toBeVisible()
    await page.getByTestId("target-item-1").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-1-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("Iron plate")
    await dropdown.locator("[cmdk-item]").first().click()
    await page.getByTestId("target-rate-1").fill("10")

    const statsAfter = await page.getByTestId("flow-stats").textContent()
    expect(statsAfter).not.toBe(statsBefore)
  })

  test("combobox: fuzzy search filters items and selects on click", async ({ page }) => {
    await page.getByTestId("target-item-0").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-0-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("plate")
    const visibleItems = await dropdown.locator("[cmdk-item]").allTextContents()
    expect(visibleItems.length).toBeGreaterThan(0)
    expect(visibleItems.every((t) => /plate/i.test(t))).toBe(true)
  })

  test("removes a target row", async ({ page }) => {
    await page.getByTestId("target-add").click()
    await expect(page.getByTestId("target-row-1")).toBeVisible()
    await page.getByTestId("target-remove-1").click()
    await expect(page.getByTestId("target-row-1")).not.toBeVisible()
  })

  test("renders an icon for the active target", async ({ page }) => {
    const icon = page.getByRole("img", { name: /circuit/i }).first()
    await expect(icon).toBeVisible()
  })

  test("renders the schematic tab with a canvas + cell inspector", async ({ page }) => {
    await page.getByTestId("tab-schematic").click()
    const canvas = page.getByTestId("schematic-canvas")
    await expect(canvas).toBeVisible()
    const dims = await canvas.evaluate((c) => {
      const el = c as HTMLCanvasElement
      return { w: el.width, h: el.height }
    })
    expect(dims.w).toBeGreaterThan(64)
    expect(dims.h).toBeGreaterThan(64)
    await expect(page.getByTestId("cell-inspector-empty")).toBeVisible()
  })

  test("schematic zoom slider resizes the canvas", async ({ page }) => {
    // The zoom widget moved from standalone toolbar buttons into the
    // Topology Panel as a range slider (`tf-zoom`). React listens on
    // "input" for range inputs — fill() dispatches it automatically;
    // an explicit dispatchEvent("change") was a silent no-op.
    await page.getByTestId("tab-schematic").click()
    const canvas = page.getByTestId("schematic-canvas")
    const before = await canvas.evaluate((c) => (c as HTMLCanvasElement).width)
    const slider = page.getByTestId("tf-zoom")
    await slider.fill("28")
    await slider.dispatchEvent("input")
    await expect.poll(async () =>
      canvas.evaluate((c) => (c as HTMLCanvasElement).width),
    ).toBeGreaterThan(before)
    await slider.fill("18")
    await slider.dispatchEvent("input")
    await expect.poll(async () =>
      canvas.evaluate((c) => (c as HTMLCanvasElement).width),
    ).toBe(before)
  })
})
