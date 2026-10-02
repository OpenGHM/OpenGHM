import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const status = { pending: false };
vi.mock("next/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/link")>()),
  useLinkStatus: () => status,
}));

import { LinkPending } from "./link-pending";

afterEach(() => {
  cleanup();
  status.pending = false;
});

describe("LinkPending", () => {
  it("renders nothing while the link is not pending", () => {
    const { container } = render(<LinkPending />);
    expect(container.querySelector('[data-slot="link-pending"]')).toBeNull();
  });

  it("shows a decorative spinner that waits before it appears, while the link is pending", () => {
    status.pending = true;
    const { container } = render(<LinkPending />);
    const spinner = container.querySelector('[data-slot="link-pending"]')!;
    expect(spinner).not.toBeNull();
    expect(spinner.getAttribute("aria-hidden")).toBe("true");
    expect(spinner.className).toContain("reveal-delayed");
  });
});
