import { afterEach, describe, expect, it, vi } from "vitest";
import { siteFeatures } from "@/lib/features";

afterEach(() => vi.unstubAllEnvs());

describe("siteFeatures", () => {
  it("opens the Workspace unless WORKSPACE_ENABLED is \"false\"", () => {
    vi.stubEnv("WORKSPACE_ENABLED", "");
    expect(siteFeatures().workspace).toBe(true);
    vi.stubEnv("WORKSPACE_ENABLED", "true");
    expect(siteFeatures().workspace).toBe(true);
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect(siteFeatures().workspace).toBe(false);
  });
});
