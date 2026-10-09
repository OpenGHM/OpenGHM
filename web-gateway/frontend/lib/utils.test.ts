import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps the later of two shadows when one is a custom scale value", () => {
    expect(cn("shadow-xs", "shadow-card")).toBe("shadow-card");
    expect(cn("shadow-card", "shadow-raised")).toBe("shadow-raised");
    expect(cn("shadow-raised", "shadow-md")).toBe("shadow-md");
  });

  it("keeps the later of two radii when one is a custom scale value", () => {
    expect(cn("rounded-lg", "rounded-card")).toBe("rounded-card");
    expect(cn("rounded-card", "rounded-panel")).toBe("rounded-panel");
    expect(cn("rounded-panel", "rounded-full")).toBe("rounded-full");
  });

  it("does not mix the custom values up with a shadow colour or a ring", () => {
    expect(cn("shadow-card", "shadow-black/10")).toBe("shadow-card shadow-black/10");
    expect(cn("shadow-card", "ring-1")).toBe("shadow-card ring-1");
  });

  it("still drops falsy inputs and ordinary conflicts", () => {
    expect(cn("p-2", false && "p-4", "p-3")).toBe("p-3");
  });
});
