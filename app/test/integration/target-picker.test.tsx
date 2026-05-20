import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TargetPicker } from "../../src/views/TargetPicker"
import { loadCatalog } from "../../src/factorio"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("<TargetPicker />", () => {
  it("renders one row per target", () => {
    render(
      <TargetPicker
        catalog={catalog}
        targets={[
          { item: "iron-plate", rate: 1 },
          { item: "copper-plate", rate: 2 },
        ]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId("target-row-0")).toBeInTheDocument()
    expect(screen.getByTestId("target-row-1")).toBeInTheDocument()
  })

  it("calls onChange with a new row when add is clicked", async () => {
    const onChange = vi.fn()
    render(
      <TargetPicker
        catalog={catalog}
        targets={[{ item: "iron-plate", rate: 1 }]}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByTestId("target-add"))
    expect(onChange).toHaveBeenCalledTimes(1)
    const newTargets = onChange.mock.calls[0][0]
    expect(newTargets).toHaveLength(2)
    // Second row should NOT duplicate the first item
    expect(newTargets[1].item).not.toBe("iron-plate")
  })

  it("calls onChange with updated rate when input changes", () => {
    const onChange = vi.fn()
    render(
      <TargetPicker
        catalog={catalog}
        targets={[{ item: "iron-plate", rate: 1 }]}
        onChange={onChange}
      />,
    )
    // Use fireEvent.change for controlled inputs — userEvent.type accumulates
    // because the controlled input value never updates between keystrokes.
    fireEvent.change(screen.getByTestId("target-rate-0"), { target: { value: "5" } })
    expect(onChange).toHaveBeenCalledWith([{ item: "iron-plate", rate: 5 }])
  })

  it("removes the correct row", async () => {
    const onChange = vi.fn()
    render(
      <TargetPicker
        catalog={catalog}
        targets={[
          { item: "iron-plate", rate: 1 },
          { item: "copper-plate", rate: 2 },
        ]}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByTestId("target-remove-0"))
    expect(onChange).toHaveBeenCalledWith([{ item: "copper-plate", rate: 2 }])
  })

  it("disables the last remove button (can't drop below 1 target)", () => {
    render(
      <TargetPicker
        catalog={catalog}
        targets={[{ item: "iron-plate", rate: 1 }]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByTestId("target-remove-0")).toBeDisabled()
  })
})
