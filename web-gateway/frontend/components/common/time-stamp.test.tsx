import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { TimeStamp } from "@/components/common/time-stamp";

// A zone west of UTC is where a date-only value used to slip a day: it parses
// as UTC midnight, which is still the evening before in New York.
const ZONE = "America/New_York";
let savedZone: string | undefined;

beforeEach(() => {
  savedZone = process.env.TZ;
  process.env.TZ = ZONE;
});

afterEach(() => {
  cleanup();
  if (savedZone === undefined) delete process.env.TZ;
  else process.env.TZ = savedZone;
});

describe("TimeStamp, date-only value", () => {
  it("runs in the zone the test sets", () => {
    expect(new Date("2022-02-23").getDate()).toBe(22);
  });

  it("reads the same day before hydration (server render)", () => {
    const html = renderToString(<TimeStamp value="2022-02-23" format="date" />);
    expect(html).toContain("23 Feb 2022");
    expect(html).not.toContain("22 Feb");
  });

  it("reads the same day after hydration", () => {
    const { container } = render(<TimeStamp value="2022-02-23" format="date" />);
    expect(container.querySelector("time")?.textContent).toBe("Feb 23, 2022");
  });
});

describe("TimeStamp, full timestamp", () => {
  it("still converts to the viewer's zone after hydration", () => {
    // 01:30 UTC on the 23rd is the evening of the 22nd in New York.
    const { container } = render(<TimeStamp value="2022-02-23T01:30:00Z" format="date" />);
    expect(container.querySelector("time")?.textContent).toBe("Feb 22, 2022");
  });

  it("still prints UTC before hydration", () => {
    const html = renderToString(<TimeStamp value="2022-02-23T01:30:00Z" format="date" />);
    expect(html).toContain("23 Feb 2022");
  });
});
