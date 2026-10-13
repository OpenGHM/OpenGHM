import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  createWorkshop: vi.fn(),
  updateWorkshop: vi.fn(),
  deleteWorkshop: vi.fn(),
  createTutorial: vi.fn(),
  updateTutorial: vi.fn(),
  deleteTutorial: vi.fn(),
  createPublication: vi.fn(),
  updatePublication: vi.fn(),
  deletePublication: vi.fn(),
  saveAdminSettings: vi.fn(),
  deleteCommunityFile: vi.fn(),
  bulkContent: vi.fn(),
  bulkDeleteFiles: vi.fn(),
}));
const { uploadCommunityFile, toast, refresh, replace } = vi.hoisted(() => ({
  uploadCommunityFile: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/lib/community/admin-actions", () => actions);
vi.mock("@/lib/community/admin-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/community/admin-upload")>()),
  uploadCommunityFile,
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
  usePathname: () => "/admin/community/workshops/new",
}));
// The rich-text editor has its own tests; here it is a box that reports what is typed.
vi.mock("@/components/admin/community/rich-text-editor", () => ({
  RichTextEditor: ({ onChange, ariaLabel, labelledBy }: { onChange: (doc: unknown) => void; ariaLabel?: string; labelledBy?: string }) => (
    <button
      type="button"
      aria-label={ariaLabel ?? "stub body"}
      aria-labelledby={labelledBy}
      onClick={() => onChange({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] })}
    >
      write body
    </button>
  ),
}));

import { FileUploadButton } from "@/components/admin/community/file-upload-button";
import { FilesLibrary } from "@/components/admin/community/files-library";
import { PublicationManager } from "@/components/admin/community/publication-manager";
import { SettingsForm } from "@/components/admin/community/settings-form";
import { TutorialEditor } from "@/components/admin/community/tutorial-editor";
import { WorkshopEditor } from "@/components/admin/community/workshop-editor";
import type { CommunityFile, Publication, Tutorial, Workshop } from "@/lib/community/types";

// Radix menus read what jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const meta = { created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", updated_by: "u1" };

const stored: Workshop = {
  id: "w1",
  state: "published",
  status: "upcoming",
  slug: "first",
  title: "First workshop",
  summary: "S",
  date: "2027-02-15",
  end_date: null,
  when_label: null,
  format: "Online",
  location: null,
  cover: null,
  signup: null,
  details: [],
  materials: [],
  body: null,
  ...meta,
};

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: /Create workshop|Save changes|Save settings|Save$/ }));

describe("a new workshop", () => {
  it("follows the title with the slug until the slug is typed by hand", () => {
    render(<WorkshopEditor workshop={null} />);
    type("Title", "First OpenGHM Workshop!");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("first-openghm-workshop");
    type("Slug", "my-own");
    type("Title", "Another title");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("my-own");
    // Clearing the slug hands it back to the title.
    type("Slug", "");
    type("Title", "Third title");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("third-title");
  });

  it("marks what is missing beside the fields and sends nothing", async () => {
    render(<WorkshopEditor workshop={null} />);
    save();
    expect(await screen.findByText("Give the workshop a title.")).toBeTruthy();
    expect(screen.getByText("Choose the first day.")).toBeTruthy();
    expect(actions.createWorkshop).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
  });

  it("creates it as a draft, then opens its own page", async () => {
    actions.createWorkshop.mockResolvedValue({ ok: true, data: { ...stored, id: "new-id", state: "draft" } });
    render(<WorkshopEditor workshop={null} />);
    type("Title", "First workshop");
    type("First day", "2027-02-15");
    save();
    await waitFor(() => expect(actions.createWorkshop).toHaveBeenCalled());
    expect(actions.createWorkshop.mock.calls[0][0]).toMatchObject({
      state: "draft",
      slug: "first-workshop",
      title: "First workshop",
      date: "2027-02-15",
      end_date: null,
      cover: null,
      body: null,
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/community/workshops/new-id"));
    expect(toast.success).toHaveBeenCalledWith("Workshop saved.");
  });

  it("puts a taken slug beside the slug field", async () => {
    actions.createWorkshop.mockResolvedValue({
      ok: false,
      reason: "error",
      status: 409,
      code: "slug_taken",
      message: "That slug is already used.",
      errors: [{ path: "slug", message: "That slug is already used." }],
    });
    render(<WorkshopEditor workshop={null} />);
    type("Title", "First workshop");
    type("First day", "2027-02-15");
    save();
    const slug = screen.getByLabelText("Slug");
    expect(await screen.findAllByText("That slug is already used.")).not.toHaveLength(0);
    await waitFor(() => expect(slug.getAttribute("aria-invalid")).toBe("true"));
    expect(replace).not.toHaveBeenCalled();
    // Editing a field clears what the backend said about the last request.
    type("Slug", "another");
    expect(slug.getAttribute("aria-invalid")).toBeNull();
  });

  it("maps a 422 on a detail row back to the row, counting only the rows that were sent", async () => {
    actions.createWorkshop.mockResolvedValue({
      ok: false,
      reason: "error",
      status: 422,
      message: "bad",
      errors: [{ path: "details.0.value", message: "Value is too long." }],
    });
    render(<WorkshopEditor workshop={null} />);
    type("Title", "First workshop");
    type("First day", "2027-02-15");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    const labels = screen.getAllByLabelText("Label");
    const values = screen.getAllByLabelText("Value");
    // The first row stays blank and is not sent; the second is sent as row 0.
    fireEvent.change(labels[1], { target: { value: "Computing" } });
    fireEvent.change(values[1], { target: { value: "Anvil" } });
    save();
    expect(await screen.findByText("Value is too long.")).toBeTruthy();
    expect(values[1].getAttribute("aria-invalid")).toBe("true");
    expect(values[0].getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the sign-in banner, not an error, when the session has ended", async () => {
    actions.createWorkshop.mockResolvedValue({ ok: false, reason: "session_expired" });
    render(<WorkshopEditor workshop={null} />);
    type("Title", "First workshop");
    type("First day", "2027-02-15");
    save();
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it("keeps what was typed and says so when the request throws", async () => {
    actions.createWorkshop.mockRejectedValue(new Error("network"));
    render(<WorkshopEditor workshop={null} />);
    type("Title", "First workshop");
    type("First day", "2027-02-15");
    save();
    expect(await screen.findByText(/Nothing was changed; try again/)).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("First workshop");
  });

  it("saves with Ctrl+S", async () => {
    actions.createWorkshop.mockResolvedValue({ ok: true, data: { ...stored, id: "n" } });
    render(<WorkshopEditor workshop={null} />);
    type("Title", "First workshop");
    type("First day", "2027-02-15");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(actions.createWorkshop).toHaveBeenCalled());
  });
});

describe("a stored workshop", () => {
  it("starts with nothing unsaved, and says so after an edit", () => {
    render(<WorkshopEditor workshop={stored} />);
    expect(screen.getByText("All changes saved")).toBeTruthy();
    type("Summary", "A new summary");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    type("Summary", "S");
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("asks before the browser leaves with unsaved changes, and not otherwise", () => {
    render(<WorkshopEditor workshop={stored} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    type("Summary", "Changed");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("updates in place, keeps the editor, and refreshes the page's own data", async () => {
    actions.updateWorkshop.mockResolvedValue({ ok: true, data: { ...stored, summary: "New" } });
    render(<WorkshopEditor workshop={stored} />);
    type("Summary", "New");
    save();
    await waitFor(() => expect(actions.updateWorkshop).toHaveBeenCalledWith("w1", expect.objectContaining({ summary: "New", slug: "first" })));
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers View on site for a published workshop and not for a draft", () => {
    const { unmount } = render(<WorkshopEditor workshop={stored} />);
    expect(screen.getByRole("link", { name: /View on site/ }).getAttribute("href")).toBe("/community/workshops/first");
    unmount();
    render(<WorkshopEditor workshop={{ ...stored, state: "draft" }} />);
    expect(screen.queryByRole("link", { name: /View on site/ })).toBeNull();
  });

  it("turns View on site into Save & view while there are unsaved changes, and opens the saved page", async () => {
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    actions.updateWorkshop.mockResolvedValue({ ok: true, data: { ...stored, slug: "renamed", summary: "New" } });
    render(<WorkshopEditor workshop={stored} />);
    type("Summary", "New");
    expect(screen.queryByRole("link", { name: /View on site/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save & view/ }));
    // The tab opens on the click itself, so no popup blocker stops it.
    expect(open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(tab.location.href).toBe("/community/workshops/renamed"));
    expect(tab.opener).toBeNull();
    expect(actions.updateWorkshop).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("link", { name: /View on site/ })).toBeTruthy());
    open.mockRestore();
  });

  it("closes the tab Save & view opened when the save fails or the workshop was hidden", async () => {
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    actions.updateWorkshop.mockResolvedValue({ ok: false, reason: "error", message: "Nope" });
    const { unmount } = render(<WorkshopEditor workshop={stored} />);
    type("Summary", "New");
    fireEvent.click(screen.getByRole("button", { name: /Save & view/ }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.href).toBe("");
    unmount();

    tab.close.mockClear();
    actions.updateWorkshop.mockResolvedValue({ ok: true, data: { ...stored, state: "draft", summary: "New" } });
    render(<WorkshopEditor workshop={stored} />);
    type("Summary", "New");
    fireEvent.click(screen.getByRole("button", { name: /Save & view/ }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(toast.info).toHaveBeenCalled();
    open.mockRestore();
  });

  it("offers Cancel back to the list", () => {
    render(<WorkshopEditor workshop={stored} />);
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/admin/community/workshops");
  });

  it("picks the format from a list, and takes any other in words", async () => {
    actions.updateWorkshop.mockResolvedValue({ ok: true, data: stored });
    render(<WorkshopEditor workshop={stored} />);
    const select = screen.getByRole("combobox", { name: /^Format/ }) as HTMLSelectElement;
    expect(select.value).toBe("Online");
    expect([...select.options].map((o) => o.text)).toEqual(["Not given", "Online", "In person", "Hybrid", "Other…"]);
    fireEvent.change(select, { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Format, in your words"), { target: { value: "Webinar" } });
    save();
    await waitFor(() => expect(actions.updateWorkshop).toHaveBeenCalledWith("w1", expect.objectContaining({ format: "Webinar" })));
  });

  it("opens a format that is not in the list under Other", () => {
    render(<WorkshopEditor workshop={{ ...stored, format: "Webinar" }} />);
    expect((screen.getByRole("combobox", { name: /^Format/ }) as HTMLSelectElement).value).toBe("other");
    expect((screen.getByLabelText("Format, in your words") as HTMLInputElement).value).toBe("Webinar");
  });

  it("sends the body written in the editor", async () => {
    actions.updateWorkshop.mockResolvedValue({ ok: true, data: stored });
    render(<WorkshopEditor workshop={stored} />);
    fireEvent.click(screen.getByRole("button", { name: "Page text" }));
    save();
    await waitFor(() => expect(actions.updateWorkshop).toHaveBeenCalled());
    expect(actions.updateWorkshop.mock.calls[0][1].body).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
    });
  });

  it("confirms before it deletes, then goes back to the list", async () => {
    actions.deleteWorkshop.mockResolvedValue({ ok: true, data: null });
    render(<WorkshopEditor workshop={stored} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete this workshop?")).toBeTruthy();
    expect(actions.deleteWorkshop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete workshop" }));
    await waitFor(() => expect(actions.deleteWorkshop).toHaveBeenCalledWith("w1"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/community/workshops"));
  });

  it("adds, fills and reorders materials, and fills the note of an uploaded file", async () => {
    render(<WorkshopEditor workshop={stored} />);
    fireEvent.click(screen.getByRole("button", { name: "Add material" }));
    fireEvent.click(screen.getByRole("button", { name: "Add material" }));
    const names = screen.getAllByLabelText("Name");
    fireEvent.change(names[0], { target: { value: "Slides" } });
    fireEvent.change(names[1], { target: { value: "Recording" } });
    fireEvent.click(screen.getByRole("button", { name: "Move material 2 up" }));
    expect((screen.getAllByLabelText("Name")[0] as HTMLInputElement).value).toBe("Recording");

    uploadCommunityFile.mockResolvedValue({
      ok: true,
      file: {
        id: "0123456789abcdef01234567",
        url: "/api/community/files/0123456789abcdef01234567",
        filename: "slides.pdf",
        content_type: "application/pdf",
        size: 6.1 * 1024 * 1024,
        uploaded_at: "2026-10-10T00:00:00Z",
      },
    });
    // The first row's own upload button is the first file input after its fields.
    const inputs = screen.getAllByTestId("community-file-input");
    const materialInput = inputs[inputs.length - 2];
    fireEvent.change(materialInput, { target: { files: [new File(["x"], "slides.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect((screen.getAllByLabelText("Note (optional)")[0] as HTMLInputElement).value).toBe("PDF · 6.1 MB"));
    expect((screen.getAllByLabelText("File or link address")[0] as HTMLInputElement).value).toBe(
      "/api/community/files/0123456789abcdef01234567"
    );
  });
});

describe("a tutorial", () => {
  const tutorial: Tutorial = {
    id: "t1",
    state: "published",
    slug: "one",
    title: "Tutorial one",
    summary: "",
    kind: "notebook",
    minutes: 20,
    level: "beginner",
    snippet: "",
    action_label: null,
    url: null,
    body: null,
    position: 0,
    ...meta,
  };

  it("shows the kind's default as the button text's placeholder and hint", () => {
    render(<TutorialEditor tutorial={tutorial} />);
    const field = screen.getByLabelText("Button text (optional)") as HTMLInputElement;
    expect(field.placeholder).toBe("Open notebook");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "video" } });
    expect(field.placeholder).toBe("Watch video");
    expect(screen.getByText(/Watch video/, { selector: "p" })).toBeTruthy();
  });

  it("offers View on site only with page text", () => {
    const { unmount } = render(<TutorialEditor tutorial={tutorial} />);
    expect(screen.queryByRole("link", { name: /View on site/ })).toBeNull();
    unmount();
    render(
      <TutorialEditor
        tutorial={{ ...tutorial, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] } }}
      />
    );
    expect(screen.getByRole("link", { name: /View on site/ }).getAttribute("href")).toBe("/community/tutorials/one");
  });

  it("checks the minutes before it sends", async () => {
    render(<TutorialEditor tutorial={tutorial} />);
    type("Minutes (optional)", "9000");
    save();
    expect(await screen.findByText("Use a whole number of minutes, 1 to 600.")).toBeTruthy();
    expect(actions.updateTutorial).not.toHaveBeenCalled();
  });
});

describe("publications", () => {
  const publication: Publication = {
    id: "p1",
    state: "published",
    year: 2026,
    type: "paper",
    title: "A paper",
    authors: "Kim, I.",
    venue: "Nature",
    link_label: null,
    link_url: null,
    citation: null,
    ...meta,
  };

  it("previews the generated citation as the fields change, and a written one instead", async () => {
    render(<PublicationManager publications={[publication]} />);
    fireEvent.click(screen.getByRole("button", { name: "A paper" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Kim, I. (2026). A paper. Nature.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Venue"), { target: { value: "Science" } });
    expect(within(dialog).getByText("Kim, I. (2026). A paper. Science.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Citation (optional)"), { target: { value: "Kim 2026." } });
    expect(within(dialog).getByText("Kim 2026.", { selector: "p" })).toBeTruthy();
  });

  it("creates one and refreshes the list", async () => {
    actions.createPublication.mockResolvedValue({ ok: true, data: publication });
    render(<PublicationManager publications={[]} startNew />);
    expect(screen.getByText("No publications yet.")).toBeTruthy();
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "A paper" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.createPublication).toHaveBeenCalled());
    expect(actions.createPublication.mock.calls[0][0]).toMatchObject({ title: "A paper", type: "paper", state: "draft", citation: null });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The sheet was opened by `?new=1`; closing it drops the parameter.
    expect(replace).toHaveBeenCalledWith("/admin/community/publications", { scroll: false });
  });

  it("has a checkbox per row, a select-all, and the title opens the sheet", async () => {
    render(<PublicationManager publications={[publication]} />);
    expect(screen.getAllByRole("checkbox", { name: "Select all publications" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("checkbox", { name: "Select A paper" })).toBeTruthy();
    // A publication has no page of its own on the site, and no Edit button: its title opens the sheet.
    expect(screen.queryByRole("link", { name: /on site/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("button", { name: `Hide ${publication.title}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Delete ${publication.title}` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: publication.title }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("deletes the selected publications after asking, and publishes them from the bar", async () => {
    actions.bulkContent.mockResolvedValue({ ok: true, data: { done: [publication.id], missing: [] } });
    render(<PublicationManager publications={[publication]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select A paper" }));
    const bar = screen.getByRole("region", { name: "Selected publications" });
    fireEvent.click(within(bar).getByRole("button", { name: "Show" }));
    await waitFor(() => expect(actions.bulkContent).toHaveBeenCalledWith("publications", "publish", [publication.id]));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select A paper" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected publications" })).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this publication?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete publication" }));
    await waitFor(() => expect(actions.bulkContent).toHaveBeenLastCalledWith("publications", "delete", [publication.id]));
  });

  it("asks before it closes a sheet with unsaved input", async () => {
    render(<PublicationManager publications={[publication]} />);
    fireEvent.click(screen.getByRole("button", { name: "A paper" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(await screen.findByText("Discard your changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Discard your changes?")).toBeNull());
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Changed");
  });

  it("closes with Cancel, asking first only when something was typed", async () => {
    render(<PublicationManager publications={[publication]} />);
    fireEvent.click(screen.getByRole("button", { name: "A paper" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "A paper" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard your changes?")).toBeTruthy();
  });
});

describe("page settings", () => {
  const settings = {
    hero_title: "Learn, publish and work together",
    hero_intro: "Intro",
    show_groups: true,
    groups_title: "Discussion groups",
    groups_intro: "",
    updated_at: null,
    updated_by: null,
  };

  it("sends the changed words, and the switch hides the section's fields", async () => {
    actions.saveAdminSettings.mockResolvedValue({ ok: true, data: settings });
    render(<SettingsForm settings={settings} />);
    type("Title", "A new heading");
    const toggle = screen.getByRole("switch", { name: "Show this section" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByLabelText("Section title") as HTMLInputElement).disabled).toBe(true);
    save();
    await waitFor(() => expect(actions.saveAdminSettings).toHaveBeenCalled());
    expect(actions.saveAdminSettings.mock.calls[0][0]).toEqual({
      hero_title: "A new heading",
      hero_intro: "Intro",
      show_groups: false,
      groups_title: "Discussion groups",
      groups_intro: "",
    });
  });
});

describe("the file upload button", () => {
  it("uploads each chosen file and hands it on, one after another", async () => {
    const onUploaded = vi.fn();
    uploadCommunityFile.mockImplementation(async (file: File) => ({
      ok: true,
      file: { id: file.name, url: `/api/community/files/${file.name}`, filename: file.name, content_type: "image/png", size: 1, uploaded_at: "x" },
    }));
    render(<FileUploadButton kind="image" label="Upload photos" multiple onUploaded={onUploaded} />);
    const input = screen.getByTestId("community-file-input");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.png"), new File(["x"], "b.png")] },
    });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2));
    expect(onUploaded.mock.calls.map((c) => c[0].filename)).toEqual(["a.png", "b.png"]);
  });

  it("says why a file was refused, and which files of a batch did not go", async () => {
    uploadCommunityFile.mockImplementation(async (file: File) =>
      file.name === "bad.png"
        ? { ok: false, reason: "error", message: "That file is over the 25 MB limit." }
        : { ok: true, file: { id: "i", url: "/api/community/files/i", filename: file.name, content_type: "image/png", size: 1, uploaded_at: "x" } }
    );
    const onUploaded = vi.fn();
    render(<FileUploadButton kind="image" label="Upload photos" multiple onUploaded={onUploaded} />);
    fireEvent.change(screen.getByTestId("community-file-input"), {
      target: { files: [new File(["x"], "bad.png"), new File(["x"], "good.png")] },
    });
    expect(await screen.findByText(/1 of 2 files were not uploaded: bad\.png/)).toBeTruthy();
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("shows the session banner when the session ended", async () => {
    uploadCommunityFile.mockResolvedValue({ ok: false, reason: "session_expired" });
    render(<FileUploadButton kind="image" label="Upload image" onUploaded={vi.fn()} />);
    fireEvent.change(screen.getByTestId("community-file-input"), { target: { files: [new File(["x"], "a.png")] } });
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
  });
});

describe("the media library", () => {
  const files: CommunityFile[] = [
    { id: "a".repeat(24), url: `/api/community/files/${"a".repeat(24)}`, filename: "photo.jpg", content_type: "image/jpeg", size: 340 * 1024, uploaded_at: "2026-10-05T00:00:00Z" },
    { id: "b".repeat(24), url: `/api/community/files/${"b".repeat(24)}`, filename: "slides.pdf", content_type: "application/pdf", size: 6.1 * 1024 * 1024, uploaded_at: "2026-10-04T00:00:00Z" },
  ];
  it("shows an image as a thumbnail and another file by its type, with sizes", () => {
    render(<FilesLibrary files={files} />);
    expect(document.querySelector(`img[src="${files[0].url}"]`)).toBeTruthy();
    expect(screen.getByText("pdf")).toBeTruthy();
    expect(screen.getByText(/340 KB/)).toBeTruthy();
    expect(screen.getByText(/6\.1 MB/)).toBeTruthy();
  });

  it("copies the address content stores, from the tile's Copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<FilesLibrary files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy address of photo.jpg" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(files[0].url));
    expect(toast.success).toHaveBeenCalledWith("Copied the address of photo.jpg.");
  });

  it("warns that content may use a file before it deletes it", async () => {
    actions.bulkDeleteFiles.mockResolvedValue({ ok: true, data: { done: ["b".repeat(24)], missing: [] } });
    render(<FilesLibrary files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete slides.pdf" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/broken image or link/)).toBeTruthy();
    expect(within(dialog).getByText("“slides.pdf”")).toBeTruthy();
    expect(actions.bulkDeleteFiles).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(actions.bulkDeleteFiles).toHaveBeenCalledWith(["b".repeat(24)]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("has a checkbox on each tile and a select-all that goes indeterminate", () => {
    render(<FilesLibrary files={files} />);
    const all = screen.getByRole("checkbox", { name: "Select all files" });
    expect(all.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select photo.jpg" }));
    expect(all.getAttribute("aria-checked")).toBe("mixed");
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(all);
    expect(all.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("offers no Publish or Move to draft for files, and deletes the selected ones after a warning", async () => {
    actions.bulkDeleteFiles.mockResolvedValue({ ok: true, data: { done: files.map((f) => f.id), missing: [] } });
    render(<FilesLibrary files={files} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all files" }));
    const bar = screen.getByRole("region", { name: "Selected files" });
    expect(within(bar).queryByRole("button", { name: "Show" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Hide" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete 2 files?")).toBeTruthy();
    expect(within(dialog).getByText(/broken image or link/)).toBeTruthy();
    expect(within(dialog).getByText("“photo.jpg” and “slides.pdf”")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 files" }));
    await waitFor(() => expect(actions.bulkDeleteFiles).toHaveBeenCalledWith(files.map((f) => f.id)));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 files deleted."));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("shows the empty state", () => {
    render(<FilesLibrary files={[]} />);
    expect(screen.getByText("No files yet.")).toBeTruthy();
  });
});
