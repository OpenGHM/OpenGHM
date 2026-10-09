import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OutputVariablesTable } from "@/components/repository/output-variables-table";

afterEach(cleanup);

const VARIABLES = Array.from({ length: 8 }, (_, i) => ({
  name: `var_${i}`,
  fullName: `Variable ${i}`,
  unit: "mm/day",
}));

describe("OutputVariablesTable", () => {
  it("shows the first five rows and expands to all of them", () => {
    render(<OutputVariablesTable variables={VARIABLES} />);

    expect(screen.getAllByRole("row")).toHaveLength(1 + 5);
    const more = screen.getByRole("button", { name: "Show 3 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(more);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 8);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("has no button for a short list", () => {
    render(<OutputVariablesTable variables={VARIABLES.slice(0, 5)} />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
