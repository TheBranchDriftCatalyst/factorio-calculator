import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RecipePicker } from "../../src/components/RecipePicker"
import { loadCatalog } from "../../src/factorio"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

// Multi-product cracking recipe — handy for "icons present" assertions
// because it has both ingredients and products.
const cracking = catalog.recipes.get("crude-oil-cracking")!
const ironPlate = catalog.recipes.get("iron-plate")!

describe("<RecipePicker />", () => {
  it("renders trigger with the chosen recipe label", () => {
    render(
      <RecipePicker
        catalog={catalog}
        options={[cracking]}
        value={cracking.key}
        onChange={() => {}}
        testId="recipe-picker"
      />,
    )
    // Trigger button shows the recipe name.
    const trigger = screen.getByTestId("recipe-picker")
    expect(trigger).toHaveTextContent(cracking.name)
  })

  it("opens popover on click; closes on Escape", async () => {
    render(
      <RecipePicker
        catalog={catalog}
        options={[cracking]}
        value=""
        onChange={() => {}}
        testId="recipe-picker"
      />,
    )
    const trigger = screen.getByTestId("recipe-picker").querySelector("button")!
    expect(screen.queryByTestId("recipe-picker-popover")).toBeNull()
    await userEvent.click(trigger)
    expect(screen.getByTestId("recipe-picker-popover")).toBeInTheDocument()
    // Escape closes.
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByTestId("recipe-picker-popover")).toBeNull()
  })

  it("closes the popover on outside click", async () => {
    render(
      <div>
        <button data-testid="outside">outside</button>
        <RecipePicker
          catalog={catalog}
          options={[cracking]}
          value=""
          onChange={() => {}}
          testId="recipe-picker"
        />
      </div>,
    )
    const trigger = screen.getByTestId("recipe-picker").querySelector("button")!
    await userEvent.click(trigger)
    expect(screen.getByTestId("recipe-picker-popover")).toBeInTheDocument()
    // Outside click closes (mousedown).
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByTestId("recipe-picker-popover")).toBeNull()
  })

  it("highlights the Default option when value is empty", async () => {
    render(
      <RecipePicker
        catalog={catalog}
        options={[cracking]}
        value=""
        onChange={() => {}}
        testId="recipe-picker"
      />,
    )
    const trigger = screen.getByTestId("recipe-picker").querySelector("button")!
    await userEvent.click(trigger)
    const defaultOption = screen.getByTestId("recipe-picker-option-default")
    expect(defaultOption).toBeInTheDocument()
    expect(defaultOption).toHaveTextContent(/Default/i)
  })

  it("calls onChange with the recipe key when an option is selected", async () => {
    const onChange = vi.fn()
    render(
      <RecipePicker
        catalog={catalog}
        options={[cracking, ironPlate]}
        value=""
        onChange={onChange}
        testId="recipe-picker"
      />,
    )
    const trigger = screen.getByTestId("recipe-picker").querySelector("button")!
    await userEvent.click(trigger)
    const option = screen.getByTestId(`recipe-picker-option-${cracking.key}`)
    await userEvent.click(option)
    expect(onChange).toHaveBeenCalledWith(cracking.key)
  })

  it("renders ingredient + product item icons inside each recipe card", async () => {
    render(
      <RecipePicker
        catalog={catalog}
        options={[cracking]}
        value=""
        onChange={() => {}}
        testId="recipe-picker"
      />,
    )
    const trigger = screen.getByTestId("recipe-picker").querySelector("button")!
    await userEvent.click(trigger)
    const card = screen.getByTestId(`recipe-picker-option-${cracking.key}`)
    // cracking has 1 ingredient (crude-oil) and 2 products (light + heavy oil).
    // ItemIcon renders an <Icon> which has role="img" + aria-label=item.name.
    const icons = card.querySelectorAll('[role="img"]')
    // 1 ingredient + 2 products + (optionally) a machine icon footer.
    expect(icons.length).toBeGreaterThanOrEqual(3)
    // Specific check: crude-oil icon must be present.
    expect(card.querySelector('[aria-label="Crude oil"]')).not.toBeNull()
    expect(card.querySelector('[aria-label="Light oil"]')).not.toBeNull()
    expect(card.querySelector('[aria-label="Heavy oil"]')).not.toBeNull()
  })
})
