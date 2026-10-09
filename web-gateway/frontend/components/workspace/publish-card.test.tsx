import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Job, PublishFailureCause } from "@/lib/jobs/types";

vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus: vi.fn(),
  publishDraft: vi.fn(),
  cancelJob: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { PublishCard } from "@/components/workspace/publish-card";
import { pollJobStatus, publishDraft } from "@/lib/jobs/actions";
import { fakePublish, previewDraftJob } from "@/lib/workspace/fixtures";
import { PUBLISH_FAILURE_COPY, PUBLISH_RETRY_COPY } from "@/lib/workspace/failure-copy";
import { PUBLISH_FAILED_CAUSES } from "@/lib/workspace/preview";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  // Nothing the card shows depends on the poll unless a test says so: it fails, and the card keeps what it has.
  vi.mocked(pollJobStatus).mockReset();
  vi.mocked(pollJobStatus).mockResolvedValue({ ok: false, reason: "error", message: "x", status: 502 });
  vi.mocked(publishDraft).mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

const ABOUT = {
  name: "A published run",
  description: "What it holds.",
  tags: ["tutorial"],
  creator: [{ name: "Ada Lovelace", email: "ada@example.test" }],
  license: "CC-BY-4.0",
  keywords: ["wbm", "discharge"],
} as unknown as NonNullable<Job["about"]>;

/** The job of a preview key, with its `about` set the way a derived draft has it. */
const job = (key: string, over: Partial<Job> = {}) =>
  previewDraftJob(key, { overrides: { id: "job-1", about: ABOUT, ...over } });

/** The card as `JobDetail` feeds it. Not a preview unless asked: the actions are mocked. */
function card(j: Job, { preview = false }: { preview?: boolean } = {}) {
  return (
    <LiveJobProvider
      jobId={j.id}
      initialStatus={j.status}
      initialData={{ work_dir: j.work_dir, failure: j.failure, files: j.files, output: j.output, publish: j.publish }}
      preview={preview}
    >
      <PublishCard job={j} preview={preview} />
    </LiveJobProvider>
  );
}

const ID = fakePublish("publishing").snapshot_id;

describe("when there is nothing to offer", () => {
  it.each(["pending", "running", "failed:wbm_error", "cancelled:user"])("shows nothing for a %s draft", (key) => {
    const { container } = render(card(job(key), { preview: true }));
    expect(container.textContent).toBe("");
  });

  it("shows nothing for a completed draft whose files were purged, and has no publish", () => {
    const { container } = render(card(job("completed:purged"), { preview: true }));
    expect(container.textContent).toBe("");
  });
});

describe("a publishable draft", () => {
  it("offers Publish as snapshot beside a plain statement that it is public and permanent", () => {
    render(card(job("completed")));
    expect(screen.getByRole("heading", { name: "Publish as snapshot" })).toBeTruthy();
    expect(screen.getByText(/It will be\s+public, and it cannot be changed after it is published\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish as snapshot" })).toBeTruthy();
  });

  it("is the one card in the brand colour, with a white button, until a publish exists", () => {
    const { container } = render(card(job("completed")));
    const section = container.querySelector("section")!;
    expect(section.className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Publish as snapshot" }).className).toContain("bg-card");
    cleanup();
    const published = render(card(job("publish:published")));
    expect(published.container.querySelector("section")!.className).toContain("bg-card");
    expect(published.container.querySelector("section")!.className).not.toContain("bg-primary");
  });

  it("opens the form filled from the draft's about, saying again that it is public and cannot be changed", async () => {
    render(card(job("completed")));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/This snapshot will be public, and it cannot be changed after it is\s+published\./)).toBeTruthy();
    expect((within(sheet).getByLabelText("Name") as HTMLInputElement).value).toBe("A published run");
    expect((within(sheet).getByLabelText("Description") as HTMLTextAreaElement).value).toBe("What it holds.");
    expect((within(sheet).getByLabelText(/^License/) as HTMLInputElement).value).toBe("CC-BY-4.0");
    expect((within(sheet).getByLabelText(/^Keywords/) as HTMLInputElement).value).toBe("wbm, discharge");
    expect((within(sheet).getByLabelText("Tutorial") as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByLabelText("Publication") as HTMLInputElement).checked).toBe(false);
    expect((within(sheet).getByLabelText("Creator 1 name") as HTMLInputElement)).toBeTruthy();
    // Every tag on the spec's closed list is a choice, and only those.
    expect(within(sheet).getAllByRole("checkbox")).toHaveLength(6);
  });

  it("fills creators, license, keywords and tags from the base's about when the draft stores none, and leaves name and description empty", async () => {
    const base = {
      name: "The base snapshot",
      description: "The base's own description.",
      tags: ["publication"],
      creator: [{ name: "Base Author", email: "base@example.test" }],
      license: "MIT",
      keywords: ["base", "run"],
    } as unknown as NonNullable<Job["about"]>;
    const j = job("completed", { about: null });
    render(
      <LiveJobProvider jobId={j.id} initialStatus={j.status} initialData={{ files: j.files, publish: j.publish }}>
        <PublishCard job={j} baseAbout={base} />
      </LiveJobProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    const name = within(sheet).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("");
    expect((within(sheet).getByLabelText("Description") as HTMLTextAreaElement).value).toBe("");
    expect(within(sheet).getByText("Based on: The base snapshot")).toBeTruthy();
    expect(name.getAttribute("aria-describedby")).toBeTruthy();
    expect((within(sheet).getByLabelText("Creator 1 name") as HTMLInputElement).value).toBe("Base Author");
    expect((within(sheet).getByLabelText("Creator 1 email") as HTMLInputElement).value).toBe("base@example.test");
    expect((within(sheet).getByLabelText(/^License/) as HTMLInputElement).value).toBe("MIT");
    expect((within(sheet).getByLabelText(/^Keywords/) as HTMLInputElement).value).toBe("base, run");
    expect((within(sheet).getByLabelText("Publication") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps the draft's own name and description, and shows the base's name beside the field", async () => {
    const base = { name: "The base snapshot", license: "MIT" } as unknown as NonNullable<Job["about"]>;
    const j = job("completed");
    render(
      <LiveJobProvider jobId={j.id} initialStatus={j.status} initialData={{ files: j.files, publish: j.publish }}>
        <PublishCard job={j} baseAbout={base} />
      </LiveJobProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    expect((within(sheet).getByLabelText("Name") as HTMLInputElement).value).toBe("A published run");
    expect((within(sheet).getByLabelText(/^License/) as HTMLInputElement).value).toBe("CC-BY-4.0");
    expect(within(sheet).getByText("Based on: The base snapshot")).toBeTruthy();
  });

  it("starts empty and shows no hint when there is no base about", async () => {
    render(card(job("completed", { about: null })));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    expect((within(sheet).getByLabelText(/^License/) as HTMLInputElement).value).toBe("");
    expect(within(sheet).queryByText(/Based on:/)).toBeNull();
  });

  it("asks for what is missing, sends nothing, and puts focus on the first field", async () => {
    render(card(job("completed", { about: null })));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish snapshot" }));
    expect(within(sheet).getByText("Give the snapshot a name.")).toBeTruthy();
    expect(within(sheet).getByText("Describe what the snapshot holds.")).toBeTruthy();
    expect(within(sheet).getByText("Name at least one creator.")).toBeTruthy();
    expect(within(sheet).getByText("Choose a license.")).toBeTruthy();
    expect(within(sheet).getByText("Add at least one keyword.")).toBeTruthy();
    expect(within(sheet).getByText("Pick at least one tag.")).toBeTruthy();
    expect(publishDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByLabelText("Name")));
    expect(within(sheet).getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
  });

  it("sends the about through the server action, then shows the publish as under way", async () => {
    vi.mocked(publishDraft).mockResolvedValue({ ok: true, data: { publish: fakePublish("publishing") } });
    vi.mocked(pollJobStatus).mockResolvedValue({ ok: false, reason: "error", message: "x", status: 502 });
    render(card(job("completed")));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "  Renamed run " } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish snapshot" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Publishing" })).toBeTruthy());
    expect(publishDraft).toHaveBeenCalledWith("job-1", {
      name: "Renamed run",
      description: "What it holds.",
      creator: [{ name: "Ada Lovelace", email: "ada@example.test" }],
      license: "CC-BY-4.0",
      keywords: ["wbm", "discharge"],
      tags: ["tutorial"],
    });
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The way to publish again is gone while it runs.
    expect(screen.queryByRole("button", { name: /Publish as snapshot/ })).toBeNull();
    expect(screen.getByText("#12345911")).toBeTruthy();
  });

  it("shows a 422's messages beside their fields and keeps the form open", async () => {
    vi.mocked(publishDraft).mockResolvedValue({
      ok: false,
      reason: "error",
      status: 422,
      code: "invalid_about",
      message: "The about block is not valid.",
      errors: [
        { path: "about.license", message: "Not an SPDX identifier." },
        { path: "about.tags.0", message: "Not a known tag." },
      ],
    });
    render(card(job("completed")));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish snapshot" }));

    await waitFor(() => expect(within(sheet).getByText("Not an SPDX identifier.")).toBeTruthy());
    const license = within(sheet).getByLabelText(/^License/);
    expect(license.getAttribute("aria-invalid")).toBe("true");
    expect(license.getAttribute("aria-describedby")).toBe(within(sheet).getByText("Not an SPDX identifier.").id);
    expect(within(sheet).getByText("Not a known tag.")).toBeTruthy();
    expect(within(sheet).getByRole("alert").textContent).toMatch(/Nothing was published/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Editing a field clears what the backend said about it.
    fireEvent.change(license, { target: { value: "MIT" } });
    expect(within(sheet).queryByText("Not an SPDX identifier.")).toBeNull();
  });

  it("says anything else the backend refused with, in its own words, and stays open", async () => {
    vi.mocked(publishDraft).mockResolvedValue({
      ok: false,
      reason: "error",
      status: 503,
      code: "anvil_unreachable",
      message: "Anvil could not be reached. Nothing was started.",
    });
    render(card(job("completed")));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish snapshot" }));
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toContain("Anvil could not be reached."));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("learns from the page when a submit failed after the draft was claimed, closes the form, and offers Try again", async () => {
    vi.mocked(publishDraft).mockResolvedValue({
      ok: false,
      reason: "error",
      status: 503,
      code: "anvil_unreachable",
      message: "Anvil could not be reached, so nothing was published. Try again in a few minutes.",
    });
    vi.mocked(pollJobStatus).mockResolvedValue({
      ok: true,
      data: { job_id: "job-1", status: "COMPLETED", publish: fakePublish("anvil_unreachable") } as never,
    });
    render(card(job("completed")));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish snapshot" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { name: "Anvil couldn't be reached" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows the sign-in banner when the session has ended", async () => {
    vi.mocked(publishDraft).mockResolvedValue({ ok: false, reason: "session_expired" });
    render(card(job("completed")));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish snapshot" }));
    await waitFor(() => expect(within(sheet).getByText("Your session has expired.")).toBeTruthy());
  });

  it("sends nothing in the preview", async () => {
    render(card(job("completed"), { preview: true }));
    fireEvent.click(screen.getByRole("button", { name: "Publish as snapshot" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish snapshot" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(publishDraft).not.toHaveBeenCalled();
  });
});

describe("a publish under way", () => {
  it("names the SLURM job and the snapshot id, and offers no second publish", () => {
    render(card(job("publish:publishing"), { preview: true }));
    expect(screen.getByRole("heading", { name: "Publishing" })).toBeTruthy();
    expect(screen.getByText("#12345911")).toBeTruthy();
    expect(screen.getByText(ID)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publish as snapshot|Try again/ })).toBeNull();
  });

  it("says it is submitting while there is no SLURM job yet", () => {
    const j = job("publish:publishing");
    render(card({ ...j, publish: { ...j.publish!, slurm_job_id: null } }, { preview: true }));
    expect(screen.getByText("Submitting the publish job to Anvil…")).toBeTruthy();
  });
});

describe("a published draft", () => {
  it("shows the snapshot id to copy and the way to its page", () => {
    render(card(job("publish:published"), { preview: true }));
    expect(screen.getByRole("heading", { name: "Published as a snapshot" })).toBeTruthy();
    expect(screen.getByText(ID)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy snapshot id" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in the Data Repository" }).getAttribute("href")).toBe(`/repository/${ID}`);
    expect(screen.queryByRole("button", { name: /Publish as snapshot|Try again/ })).toBeNull();
  });
});

describe("a failed publish", () => {
  it.each(PUBLISH_FAILED_CAUSES)("says %s in its own words, then what to do by its retry", (cause: PublishFailureCause) => {
    const j = job(`publish:${cause}`);
    render(card(j, { preview: true }));
    expect(screen.getByRole("heading", { name: PUBLISH_FAILURE_COPY[cause].title })).toBeTruthy();
    expect(screen.getByText(j.publish!.failure!.message)).toBeTruthy();
    expect(screen.getByText(PUBLISH_RETRY_COPY[j.publish!.failure!.retry])).toBeTruthy();
  });

  it("uses the cause's body when the failure carries no message", () => {
    const j = job("publish:publish_upload_failed");
    render(card({ ...j, publish: { ...j.publish!, failure: { ...j.publish!.failure!, message: "" } } }, { preview: true }));
    expect(screen.getByText(PUBLISH_FAILURE_COPY.publish_upload_failed.body)).toBeTruthy();
  });

  it("for retry same, offers Try again, which sends the same about once more", async () => {
    vi.mocked(publishDraft).mockResolvedValue({ ok: true, data: { publish: fakePublish("publishing", { attempts: 2 }) } });
    vi.mocked(pollJobStatus).mockResolvedValue({ ok: false, reason: "error", message: "x", status: 502 });
    const j = job("publish:publish_upload_failed", { about: { ...ABOUT, name: "Edited since" } });
    render(card(j));
    expect(screen.queryByRole("button", { name: /Edit and publish again/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Publishing" })).toBeTruthy());
    expect(publishDraft).toHaveBeenCalledTimes(1);
    const [id, about] = vi.mocked(publishDraft).mock.calls[0];
    expect(id).toBe("job-1");
    // The attempt's own words, from the stored metadata: not the draft's, and none of what the gateway set.
    expect(about).toMatchObject({ name: "WBM v2 tutorial, 2001, rerun" });
    expect(about).not.toHaveProperty("url");
    expect(about).not.toHaveProperty("datePublished");
    expect(screen.getByText(/Attempt 2/)).toBeTruthy();
  });

  it("shows why a Try again was refused, and a 409 asks for the page to be looked at again", async () => {
    vi.mocked(publishDraft).mockResolvedValue({
      ok: false,
      reason: "error",
      status: 409,
      code: "not_publishable",
      message: "A publish is already running for this snapshot draft.",
      conflictReason: "publishing",
    });
    vi.mocked(pollJobStatus).mockResolvedValue({ ok: true, data: { job_id: "job-1", status: "COMPLETED", publish: fakePublish("publishing") } as never });
    render(card(job("publish:publish_job_failed")));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already running"));
    await waitFor(() => expect(pollJobStatus).toHaveBeenCalled());
  });

  it("for retry edit, offers the form instead, filled from what the failed publish was composed from", async () => {
    const j = job("publish:publish_bad_input", { about: { ...ABOUT, name: "Edited since" } });
    render(card(j));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit and publish again" }));
    const sheet = await screen.findByRole("dialog");
    expect((within(sheet).getByLabelText("Name") as HTMLInputElement).value).toBe("WBM v2 tutorial, 2001, rerun");
  });

  it("for retry none, offers nothing, says an administrator has to look, and gives the id to tell them", () => {
    render(card(job("publish:publish_setup")));
    expect(screen.queryByRole("button", { name: /Try again|Edit and publish again|Publish as snapshot/ })).toBeNull();
    expect(screen.getByText(PUBLISH_RETRY_COPY.none)).toBeTruthy();
    expect(screen.getByText("job-1")).toBeTruthy();
  });
});
