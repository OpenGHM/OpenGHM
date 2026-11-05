import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/landing/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <footer /> }));

import { CodeNotCurrent } from "./code-not-current";

afterEach(cleanup);

const MESSAGE =
  "This snapshot runs WBM code 22.1.1, which is legacy: snapshots on it keep working, but no new snapshot draft starts from them, so a new snapshot draft cannot start from it. Start from a snapshot on current code (23.9.0).";

describe("CodeNotCurrent", () => {
  it("shows the backend's sentence as it is, announced as an alert", () => {
    render(<CodeNotCurrent datasetId="snap-1" message={MESSAGE} />);
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE);
    expect(screen.getByRole("heading", { name: "This model snapshot cannot start a new snapshot draft" })).toBeTruthy();
  });

  it("leads back to the snapshot choice, and to the snapshot itself", () => {
    render(<CodeNotCurrent datasetId="snap/1" message={MESSAGE} />);
    expect(screen.getByRole("link", { name: "Choose another model snapshot" }).getAttribute("href")).toBe("/workspace/new");
    expect(screen.getByRole("link", { name: "View this model snapshot" }).getAttribute("href")).toBe("/repository/snap%2F1");
  });
});
