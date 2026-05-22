import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InputPicker } from "../../src/views/InputPicker"
import { loadCatalog } from "../../src/factorio"
import { miniDataset } from "../fixtures/mini-dataset"

const catalog = loadCatalog(miniDataset)

describe("<InputPicker />", () => {
  it("renders the empty state when there are no inputs", () => {
    render(<InputPicker catalog={catalog} inputs={[]} onChange={() => {}} />)
    expect(screen.getByTestId("inputs-empty")).toBeInTheDocument()
  })

  it("appends a new row when + Add input is clicked", async () => {
    const onChange = vi.fn()
    render(
      <InputPicker
        catalog={catalog}
        inputs={[{ item: "iron-plate", rate: 1 }]}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByTestId("input-add"))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(next).toHaveLength(2)
    // Avoid duplicating an existing item.
    expect(next[1].item).not.toBe("iron-plate")
  })

  it("drops the row when remove is clicked", async () => {
    const onChange = vi.fn()
    render(
      <InputPicker
        catalog={catalog}
        inputs={[
          { item: "iron-plate", rate: 1 },
          { item: "copper-plate", rate: 2 },
        ]}
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByTestId("input-remove-0"))
    expect(onChange).toHaveBeenCalledWith([{ item: "copper-plate", rate: 2 }])
  })

  it("calls onChange with the updated rate when the input changes", () => {
    const onChange = vi.fn()
    render(
      <InputPicker
        catalog={catalog}
        inputs={[{ item: "iron-plate", rate: 1 }]}
        onChange={onChange}
      />,
    )
    // The default unit is /sec, so typing "5" sends rate=5.
    fireEvent.change(screen.getByTestId("input-rate-0"), { target: { value: "5" } })
    expect(onChange).toHaveBeenCalledWith([{ item: "iron-plate", rate: 5 }])
  })

  it("multiplies the draft by 60 when switching unit from /s to /min", async () => {
    const onChange = vi.fn()
    render(
      <InputPicker
        catalog={catalog}
        inputs={[{ item: "iron-plate", rate: 1 }]}
        onChange={onChange}
      />,
    )
    // Initially /sec → draft value is 1.
    const rateInput = screen.getByTestId("input-rate-0") as HTMLInputElement
    expect(rateInput.value).toBe("1")
    // Click /min — the canonical rate stays 1 items/sec, but the visible
    // draft should become 60.
    await userEvent.click(screen.getByTestId("input-rate-unit-0-min"))
    expect(rateInput.value).toBe("60")
  })
})
