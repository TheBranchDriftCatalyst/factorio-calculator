import { test, expect } from "@playwright/test"

test.describe("Factorio Blueprint Calculator — happy path", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-seed theme to keep first-paint deterministic across runs.
    await page.addInitScript(() => {
      localStorage.setItem("theme:name", JSON.stringify("catalyst"))
      localStorage.setItem("theme:variant", JSON.stringify("dark"))
    })
    await page.goto("/")
  })

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
    // At least one rect (node), one path (link), and labels with rate units
    expect(await svg.locator("rect").count()).toBeGreaterThan(2)
    expect(await svg.locator("path").count()).toBeGreaterThan(1)
    const labelTexts = await svg.locator("text").allTextContents()
    expect(labelTexts.some((t) => /\d+\.\d+\/s/.test(t))).toBe(true)
  })

  test("renders the boxline diagram with orientation toggle", async ({ page }) => {
    await page.getByTestId("tab-boxline").click()
    const svg = page.getByTestId("boxline-svg")
    await expect(svg).toBeVisible()
    // Switch orientation — view should redraw without errors
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
    // Sanity: real space-age dataset has hundreds of items, dozens of machines
    const itemsRow = rows.find((r) => r.startsWith("items"))
    expect(itemsRow).toMatch(/items\s*\d{3}/)
  })

  test("supports adding a second target and stats update", async ({ page }) => {
    const statsBefore = await page.getByTestId("flow-stats").textContent()

    await page.getByTestId("target-add").click()
    await expect(page.getByTestId("target-row-1")).toBeVisible()
    // Set a deterministic second target via the combobox: open, type, enter
    await page.getByTestId("target-item-1").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-1-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("Iron plate")
    await dropdown.locator("[cmdk-item]").first().click()
    await page.getByTestId("target-rate-1").fill("10")

    // Flow stats should reflect more demand
    const statsAfter = await page.getByTestId("flow-stats").textContent()
    expect(statsAfter).not.toBe(statsBefore)
  })

  test("combobox: fuzzy search filters items and selects on click", async ({ page }) => {
    await page.getByTestId("target-item-0").locator("button").first().click()
    const dropdown = page.getByTestId("target-item-0-dropdown")
    await expect(dropdown).toBeVisible()
    await dropdown.locator("input").fill("plate")
    // After search, items should narrow — every visible item contains the query
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
    // The ItemIcon component sets role="img" with aria-label = item name
    const icon = page.getByRole("img", { name: /circuit/i }).first()
    await expect(icon).toBeVisible()
  })

  test("renders the schematic tab with a canvas + cell inspector", async ({ page }) => {
    await page.getByTestId("tab-schematic").click()
    const canvas = page.getByTestId("schematic-canvas")
    await expect(canvas).toBeVisible()
    // Canvas should have actual pixel dimensions (not zero)
    const dims = await canvas.evaluate((c) => {
      const el = c as HTMLCanvasElement
      return { w: el.width, h: el.height }
    })
    expect(dims.w).toBeGreaterThan(64)
    expect(dims.h).toBeGreaterThan(64)
    // Empty cell inspector visible before hover
    await expect(page.getByTestId("cell-inspector-empty")).toBeVisible()
  })

  test("schematic zoom controls resize the canvas", async ({ page }) => {
    await page.getByTestId("tab-schematic").click()
    const canvas = page.getByTestId("schematic-canvas")
    const before = await canvas.evaluate((c) => (c as HTMLCanvasElement).width)
    await page.getByTestId("zoom-in").click()
    const after = await canvas.evaluate((c) => (c as HTMLCanvasElement).width)
    expect(after).toBeGreaterThan(before)
    await page.getByTestId("zoom-reset").click()
    const reset = await canvas.evaluate((c) => (c as HTMLCanvasElement).width)
    expect(reset).toBe(before)
  })
})
