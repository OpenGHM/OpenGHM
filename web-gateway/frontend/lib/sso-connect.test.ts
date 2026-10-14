import { describe, expect, it } from "vitest";
import { connectCookieValue, readConnectCookie } from "@/lib/sso-connect";

describe("the connect cookie", () => {
  it("names the user as well as the token, and reads back what it wrote", () => {
    expect(connectCookieValue("user-1", "tok")).toBe("user-1:tok");
    expect(readConnectCookie(connectCookieValue("user-1", "tok"))).toEqual({
      userId: "user-1",
      token: "tok",
    });
  });

  it("splits at the last colon, so a user id that contains one survives", () => {
    expect(readConnectCookie("a:b:tok")).toEqual({ userId: "a:b", token: "tok" });
  });

  it.each([undefined, "", "no-colon", ":tok", "user:"])("is nothing for %j", (value) => {
    expect(readConnectCookie(value)).toBeNull();
  });
});
