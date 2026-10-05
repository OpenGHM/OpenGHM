import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { updateUser, toast, refresh } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock("@/lib/admin/actions", () => ({ updateUser }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { RoleControl, RunPermissionControl, StatusControl } from "@/components/admin/user-admin-controls";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ada = { id: "u1", name: "Ada Lovelace", role: "user" as const, is_active: true };

function renderRole() {
  render(<RoleControl user={ada} disabled={false} ariaLabel="Role" />);
  const select = screen.getByLabelText("Role") as HTMLSelectElement;
  return select;
}

describe("changing a role", () => {
  it("applies nothing until it is confirmed, and names the old and the new role", async () => {
    const select = renderRole();
    fireEvent.change(select, { target: { value: "staff" } });
    expect(await screen.findByText("Change Ada Lovelace's role to staff?")).toBeTruthy();
    expect(screen.getByText(/changes from user to staff/)).toBeTruthy();
    expect(screen.getByText(/also see everyone's snapshot drafts and cancel them, but can't change accounts/)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("calls the action on confirm, then refreshes", async () => {
    updateUser.mockResolvedValue({ ok: true });
    const select = renderRole();
    fireEvent.change(select, { target: { value: "admin" } });
    fireEvent.click(await screen.findByRole("button", { name: "Change role" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(updateUser).toHaveBeenCalledWith("u1", { role: "admin" });
    expect(toast.success).toHaveBeenCalledWith("Ada Lovelace's role is now admin.");
    // Until the refreshed page brings the new role, the select keeps the choice.
    expect(select.value).toBe("admin");
  });

  it("puts the select back on the old role when the dialog is cancelled", async () => {
    const select = renderRole();
    fireEvent.change(select, { target: { value: "guest" } });
    expect(select.value).toBe("guest");
    fireEvent.click(await screen.findByRole("button", { name: "Keep current role" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(select.value).toBe("user");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("puts the select back when the dialog is dismissed with Escape", async () => {
    const select = renderRole();
    fireEvent.change(select, { target: { value: "guest" } });
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(select.value).toBe("user"));
  });

  it("stays open while pending", async () => {
    let answer: (value: unknown) => void = () => {};
    updateUser.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const select = renderRole();
    fireEvent.change(select, { target: { value: "staff" } });
    fireEvent.click(await screen.findByRole("button", { name: "Change role" }));
    await screen.findByRole("button", { name: "Changing…" });
    expect((screen.getByRole("button", { name: "Keep current role" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    answer({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the backend's reason inline and in a toast, and stays open", async () => {
    updateUser.mockResolvedValue({ ok: false, message: "Cannot remove the last active admin." });
    const select = renderRole();
    fireEvent.change(select, { target: { value: "staff" } });
    fireEvent.click(await screen.findByRole("button", { name: "Change role" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Cannot remove the last active admin.");
    expect(toast.error).toHaveBeenCalledWith("Cannot remove the last active admin.");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("deactivating and reactivating", () => {
  it("says what deactivating does, and applies nothing until confirmed", async () => {
    render(<StatusControl user={ada} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(await screen.findByText("Deactivate Ada Lovelace?")).toBeTruthy();
    expect(
      screen.getByText("They are signed out of every device and can't sign in until the account is reactivated.")
    ).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("deactivates on confirm", async () => {
    updateUser.mockResolvedValue({ ok: true });
    render(<StatusControl user={ada} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate account" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(updateUser).toHaveBeenCalledWith("u1", { is_active: false });
    expect(toast.success).toHaveBeenCalledWith("Ada Lovelace deactivated.");
  });

  it("says reactivating lets them sign in again", async () => {
    updateUser.mockResolvedValue({ ok: true });
    render(<StatusControl user={{ ...ada, is_active: false }} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivated" }));
    expect(await screen.findByText("Reactivate Ada Lovelace?")).toBeTruthy();
    expect(screen.getByText(/They can sign in again/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate account" }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith("u1", { is_active: true }));
  });

  it("keeps the account as it was on cancel", async () => {
    render(<StatusControl user={ada} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep active" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("stays open while pending, and shows a failure inline and as a toast", async () => {
    let answer: (value: unknown) => void = () => {};
    updateUser.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<StatusControl user={ada} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate account" }));
    await screen.findByRole("button", { name: "Deactivating…" });
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    answer({ ok: false });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't change the account/);
    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("is disabled where the caller says so", () => {
    render(<StatusControl user={ada} disabled />);
    expect((screen.getByRole("button", { name: "Active" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the run-permission switch", () => {
  function renderSwitch(checked: boolean, disabled = false) {
    render(
      <>
        <span id="run-label">Can run simulations</span>
        <RunPermissionControl user={ada} checked={checked} disabled={disabled} labelledBy="run-label" />
      </>
    );
    return screen.getByRole("switch", { name: "Can run simulations" }) as HTMLButtonElement;
  }

  it("says what granting does, and applies nothing until confirmed", async () => {
    const sw = renderSwitch(false);
    fireEvent.click(sw);
    expect(await screen.findByText("Let Ada Lovelace run simulations?")).toBeTruthy();
    expect(screen.getByText(/each one they run spends the shared compute allocation/)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("grants on confirm, then refreshes", async () => {
    updateUser.mockResolvedValue({ ok: true });
    const sw = renderSwitch(false);
    fireEvent.click(sw);
    fireEvent.click(await screen.findByRole("button", { name: "Allow running" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(updateUser).toHaveBeenCalledWith("u1", { can_run_simulations: true });
    expect(toast.success).toHaveBeenCalledWith("Ada Lovelace can now run simulations.");
    // Until the refreshed page brings the new value, the switch keeps it.
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("says what revoking does to jobs already submitted", async () => {
    const sw = renderSwitch(true);
    fireEvent.click(sw);
    expect(await screen.findByText("Stop Ada Lovelace from running simulations?")).toBeTruthy();
    expect(screen.getByText(/can't run new simulations/)).toBeTruthy();
    expect(screen.getByText(/Simulations already submitted keep running\./)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("revokes on confirm", async () => {
    updateUser.mockResolvedValue({ ok: true });
    const sw = renderSwitch(true);
    fireEvent.click(sw);
    fireEvent.click(await screen.findByRole("button", { name: "Stop running" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(updateUser).toHaveBeenCalledWith("u1", { can_run_simulations: false });
    expect(toast.success).toHaveBeenCalledWith("Ada Lovelace can no longer run simulations.");
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("leaves the switch where it was on cancel", async () => {
    const sw = renderSwitch(true);
    fireEvent.click(sw);
    fireEvent.click(await screen.findByRole("button", { name: "Keep allowed" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("stays open while pending, and shows a failure inline and as a toast", async () => {
    let answer: (value: unknown) => void = () => {};
    updateUser.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const sw = renderSwitch(false);
    fireEvent.click(sw);
    fireEvent.click(await screen.findByRole("button", { name: "Allow running" }));
    await screen.findByRole("button", { name: "Allowing…" });
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    answer({ ok: false, message: "User not found" });
    expect((await screen.findByRole("alert")).textContent).toBe("User not found");
    expect(toast.error).toHaveBeenCalledWith("User not found");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is disabled where the caller says so", () => {
    expect(renderSwitch(true, true).disabled).toBe(true);
  });
});
