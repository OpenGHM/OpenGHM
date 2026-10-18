import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

describe("clientIp", () => {
  it("takes the address the nearest proxy saw, not the one the browser claimed", () => {
    expect(clientIp("1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
    expect(clientIp("203.0.113.7")).toBe("203.0.113.7");
  });

  it("is undefined when there is no header or nothing in it", () => {
    expect(clientIp(null)).toBeUndefined();
    expect(clientIp(undefined)).toBeUndefined();
    expect(clientIp("")).toBeUndefined();
    expect(clientIp(" , ")).toBeUndefined();
  });
});
