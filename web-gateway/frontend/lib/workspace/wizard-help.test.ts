import { describe, expect, it } from "vitest";
import { MAX_WALLTIME } from "@/lib/jobs/types";
import { ANVIL_SHARED_MB_PER_CORE } from "@/lib/jobs/compute";
import { RETENTION_DAYS } from "@/lib/workspace/format";
import { HELP_SECTIONS, helpIndex, helpTopic, type HelpBlock, type HelpTopic } from "@/lib/workspace/wizard-help";

const ALL: HelpTopic[] = [
  helpTopic("start"),
  helpTopic("run"),
  ...HELP_SECTIONS.map((section) => helpTopic("run", section)),
  helpTopic("review"),
];

const words = (topic: HelpTopic) =>
  topic.blocks.map((b: HelpBlock) => (b.kind === "text" ? b.text : b.items.join(" "))).join(" ");

describe("helpTopic", () => {
  it("gives each step its overview", () => {
    expect(helpTopic("start").id).toBe("start");
    expect(helpTopic("run").id).toBe("run");
    expect(helpTopic("run", null).id).toBe("run");
    expect(helpTopic("review").id).toBe("review");
  });

  it("gives each section of Run settings its own topic, titled as the section is", () => {
    const titles = Object.fromEntries(HELP_SECTIONS.map((s) => [s, helpTopic("run", s).title]));
    expect(titles).toEqual({
      about: "Name and description",
      period: "Run period",
      variables: "Output variables",
      output: "Post-processing",
      compute: "Compute",
    });
    expect(new Set(HELP_SECTIONS.map((s) => helpTopic("run", s).id)).size).toBe(HELP_SECTIONS.length);
  });

  it("ignores a section on a step that has none", () => {
    expect(helpTopic("review", "compute").id).toBe("review");
    expect(helpTopic("start", "period").id).toBe("start");
  });

  it("says post-processing is not available unless the snapshot offers it", () => {
    expect(words(helpTopic("run", "output"))).toContain("Post-processing is not available yet");
    expect(words(helpTopic("run", "output", { climatologyAvailable: false }))).toContain("not available yet");
    const offered = words(helpTopic("run", "output", { climatologyAvailable: true }));
    expect(offered).not.toContain("not available");
    expect(offered).toContain("walltime then includes it");
  });

  it("explains the checkbox: output is always written, what post-processing makes depends on the init, and it is never published", () => {
    const output = words(helpTopic("run", "output", { climatologyAvailable: true }));
    expect(output).toContain("always writes daily, monthly and yearly output");
    expect(output).toContain("depends on the snapshot's init");
    expect(output).toContain("always means a new simulation");
  });

  it("reads its numbers from where the code keeps them", () => {
    expect(words(helpTopic("run", "compute"))).toContain(`${ANVIL_SHARED_MB_PER_CORE} MB`);
    expect(words(helpTopic("run", "compute"))).toContain(MAX_WALLTIME);
    expect(words(helpTopic("run", "compute"))).toContain("96 hours");
    expect(words(helpTopic("review"))).toContain(`${RETENTION_DAYS} days`);
  });

  it("is short: a heading and a few paragraphs or bullets", () => {
    for (const topic of ALL) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.blocks.length).toBeGreaterThanOrEqual(2);
      expect(topic.blocks.length).toBeLessThanOrEqual(4);
      for (const block of topic.blocks) {
        if (block.kind === "list") expect(block.items.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it("uses no internal vocabulary", () => {
    for (const topic of ALL) {
      expect(words(topic)).not.toMatch(/\bADR\b|\.tsx?\b|[A-Z]{3,}_[A-Z_]+|\bparameters\.|\bjob_script\b/);
    }
  });
});

describe("helpIndex", () => {
  it("lists the overview and then each section of Run settings, with the topics' own titles", () => {
    const index = helpIndex("run");
    expect(index.map((e) => e.section)).toEqual([null, ...HELP_SECTIONS]);
    expect(index.map((e) => e.title)).toEqual(index.map((e) => helpTopic("run", e.section).title));
    expect(index[0]).toEqual({ section: null, title: "Run settings" });
  });

  it("is empty for the steps that have no sections", () => {
    expect(helpIndex("start")).toEqual([]);
    expect(helpIndex("review")).toEqual([]);
  });
});
