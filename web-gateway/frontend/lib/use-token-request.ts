"use client";

import { useRef, useState } from "react";

export type TokenRequestStatus = "ready" | "pending" | "success" | "error";

/**
 * Spends the one-time `token` from an emailed link with a single POST, when
 * the person on the page presses the button that calls `submit` — never on
 * page load.
 *
 * Mail providers open the links in a message before delivering it (Purdue's
 * does: a verification was spent 25 seconds after sending, minutes before the
 * mail reached the inbox). A page that posted on load would let that scanner
 * verify an address, or confirm a credential an attacker staged with
 * POST /auth/register (web-gateway/backend/app/api/v1/auth.py,
 * _send_link_confirmation_email), without anyone reading the mail. Scanners
 * load pages; they do not press buttons.
 *
 * The backend deletes the token's hash the first time it is accepted, so a
 * second request with the same token is answered 400. `sent` makes `submit`
 * do nothing after the first press, a double click included.
 *
 * A missing token is an error from the first render.
 */
export function useTokenRequest(
  token: string | null,
  endpoint: string,
): { status: TokenRequestStatus; submit: () => void } {
  const [outcome, setOutcome] = useState<"pending" | "success" | "error" | null>(null);
  const sent = useRef(false);

  function submit() {
    if (!token || sent.current) return;
    sent.current = true;
    setOutcome("pending");
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => setOutcome(res.ok ? "success" : "error"))
      .catch(() => setOutcome("error"));
  }

  if (!token) return { status: "error", submit };
  return { status: outcome ?? "ready", submit };
}
