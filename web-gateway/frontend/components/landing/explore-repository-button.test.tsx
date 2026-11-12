import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExploreRepositoryButton } from "@/components/landing/explore-repository-button";
import { SiteFeaturesProvider } from "@/components/site-features";

afterEach(cleanup);

describe("ExploreRepositoryButton", () => {
  it("links to the Data Repository", () => {
    render(<ExploreRepositoryButton />);
    expect(screen.getByRole("link", { name: /Explore Data Repository/ }).getAttribute("href")).toBe("/repository");
  });

  it("is a disabled button marked Coming soon while the Data Repository is off", () => {
    render(
      <SiteFeaturesProvider features={{ workspace: true, repository: false }}>
        <ExploreRepositoryButton />
      </SiteFeaturesProvider>
    );
    expect(screen.queryByRole("link")).toBeNull();
    const button = screen.getByRole("button", { name: /Explore Data Repository/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Coming soon");
  });
});
