import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const { toast, replace } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  replace: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/dashboard/profile",
}));

import { SsoResultToast } from "@/components/dashboard/sso-result-toast";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the CILogon result toast", () => {
  it("says it connected, once, and drops the parameter from the address", () => {
    render(<SsoResultToast result="connected" />);
    expect(toast.success).toHaveBeenCalledWith("CILogon connected. You can now sign in with it.");
    expect(replace).toHaveBeenCalledWith("/dashboard/profile", { scroll: false });
  });

  it("says the identity belongs to another account on a conflict", () => {
    render(<SsoResultToast result="conflict" />);
    expect(toast.error).toHaveBeenCalledWith(
      "That CILogon identity is already connected to another OpenGHM account.",
      { duration: Infinity }
    );
  });

  it("says it failed", () => {
    render(<SsoResultToast result="failed" />);
    expect(toast.error).toHaveBeenCalledWith("Couldn't connect CILogon. Please try again.", {
      duration: Infinity,
    });
  });

  it("says nothing without a result, or for one it does not know", () => {
    render(<SsoResultToast result={undefined} />);
    render(<SsoResultToast result="whatever" />);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
