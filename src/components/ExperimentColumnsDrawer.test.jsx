import React, { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperimentColumnsDrawer } from "./ExperimentColumnsDrawer.jsx";

const columns = [
  { id: "experiment", label: "Experiment", pinned: true, recommended: true },
  { id: "temperature_c", label: "Temperature (degC)", unit: "degC", recommended: true },
  { id: "yield", label: "Yield (%)", unit: "percent", recommended: false },
];

const settings = [
  { columnId: "experiment", order: 0, width: 200, hidden: false },
  { columnId: "temperature_c", order: 1, width: 160, hidden: false },
  { columnId: "yield", order: 2, width: 150, hidden: true },
];

describe("ExperimentColumnsDrawer", () => {
  it("adds, hides, reorders, resizes, and resets unit-aware columns", () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <ExperimentColumnsDrawer
        open
        columns={columns}
        settings={settings}
        onChange={onChange}
        onReset={onReset}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Show Yield (%)" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ columnId: "yield", hidden: false }),
    ]));

    fireEvent.click(screen.getByRole("button", { name: "Move Yield (%) up" }));
    const reordered = onChange.mock.calls.at(-1)[0];
    expect(reordered.find((item) => item.columnId === "yield").order).toBe(1);
    expect(reordered.find((item) => item.columnId === "temperature_c").order).toBe(2);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Width for Temperature (degC)" }), { target: { value: "220" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ columnId: "temperature_c", width: 220 }),
    ]));

    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape and restores focus to the trigger", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const triggerRef = useRef(null);
      return (
        <>
          <button type="button" ref={triggerRef}>Choose columns</button>
          <ExperimentColumnsDrawer
            open={open}
            columns={columns}
            settings={settings}
            onChange={() => {}}
            onReset={() => {}}
            onClose={() => setOpen(false)}
            returnFocusRef={triggerRef}
          />
        </>
      );
    }
    render(<Harness />);

    fireEvent.keyDown(screen.getByRole("complementary", { name: "Configure experiment columns" }), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Configure experiment columns" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Choose columns" }));
  });
});
