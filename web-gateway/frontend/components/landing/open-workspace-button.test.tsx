import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OpenWorkspaceButton } from "@/components/landing/open-workspace-button";
import { SiteFeaturesProvider } from "@/components/site-features";

afterEach(cleanup);

describe("OpenWorkspaceButton", () => {
  it("links to the Workspace", () => {
    render(<OpenWorkspaceButton />);
    expect(screen.getByRole("link", { name: "Open Workspace" }).getAttribute("href")).toBe("/workspace");
  });

  it("is a disabled button marked Coming soon while the Workspace is off", () => {
    render(
      <SiteFeaturesProvider features={{ workspace: false }}>
        <OpenWorkspaceButton />
      </SiteFeaturesProvider>
    );
    expect(screen.queryByRole("link")).toBeNull();
    const button = screen.getByRole("button", { name: /Open Workspace/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Coming soon");
  });
});
