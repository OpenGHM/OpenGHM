import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { replace, search } = vi.hoisted(() => ({ replace: vi.fn(), search: { value: "" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

import { UserSearchFilters } from "@/components/admin/user-search-filters";

beforeEach(() => {
  vi.useFakeTimers();
  search.value = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const settle = () => act(() => vi.advanceTimersByTime(400));

describe("the user search", () => {
  it("leaves the address alone on load, so reloading page 3 stays on page 3", () => {
    search.value = "page=3&q=ada";
    render(<UserSearchFilters initialQuery="ada" />);
    settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves the address alone on load with no search either", () => {
    search.value = "page=2";
    render(<UserSearchFilters />);
    settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it("searches after a pause, and starts that search on page 1", () => {
    search.value = "page=3&role=user";
    render(<UserSearchFilters />);
    fireEvent.change(screen.getByLabelText("Search users by name or email"), { target: { value: "lovelace" } });
    expect(replace).not.toHaveBeenCalled();
    settle();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/admin/users?role=user&q=lovelace");
  });

  it("clearing the box removes the search and goes to page 1", () => {
    search.value = "page=2&q=ada";
    render(<UserSearchFilters initialQuery="ada" />);
    fireEvent.change(screen.getByLabelText("Search users by name or email"), { target: { value: "" } });
    settle();
    expect(replace).toHaveBeenCalledWith("/admin/users?");
  });

  it("does not search again for a change that is only whitespace", () => {
    search.value = "page=2&q=ada";
    render(<UserSearchFilters initialQuery="ada" />);
    fireEvent.change(screen.getByLabelText("Search users by name or email"), { target: { value: "ada " } });
    settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a filter pill still starts over on page 1", () => {
    search.value = "page=3";
    render(<UserSearchFilters />);
    fireEvent.click(screen.getByRole("button", { name: "Staff" }));
    expect(replace).toHaveBeenCalledWith("/admin/users?role=staff");
  });
});
