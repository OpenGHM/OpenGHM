import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExecutionCard } from "./execution-card";
import { fakeDataset } from "@/lib/workspace/fixtures";

afterEach(cleanup);

describe("ExecutionCard", () => {
  const dataset = fakeDataset();

  it("names the WBM code beside the container, and prints the whole tree hash", () => {
    render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} />);

    const term = (label: string) => screen.getByText(label).parentElement!;
    expect(term("WBM Code").textContent).toContain("wbm 23.9.0");
    expect(term("Code Tree Hash").textContent).toContain(dataset.uses.modelCode.treeHash);
    expect(dataset.uses.modelCode.treeHash).toHaveLength(64);
    expect(term("Container Image").textContent).toContain("wbm:2.0.0");
  });

  it("does not take the container's version for the code's", () => {
    render(<ExecutionCard uses={dataset.uses} runtime={dataset.runtime} />);

    expect(screen.getByText("WBM Code").parentElement!.textContent).not.toContain(dataset.uses.container.version);
  });
});
