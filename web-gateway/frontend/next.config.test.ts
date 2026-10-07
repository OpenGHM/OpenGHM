import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next.config redirects", () => {
  it("sends a snapshot's canonical address, /snapshots/<id>, to its page in the repository", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual([{ source: "/snapshots/:id", destination: "/repository/:id", permanent: false }]);
  });
});
