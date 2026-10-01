"use client";

import { useEffect, useRef, useState } from "react";

export type TokenRequestStatus = "pending" | "success" | "error";

/**
 * Spends the one-time `token` from an emailed link with a single POST and
 * reports how it went.
 *
 * The backend deletes the token's hash the first time it is accepted
 * (POST /auth/verify-email and POST /auth/confirm-link in
 * web-gateway/backend/app/api/v1/auth.py), so a second request with the same
 * token is answered 400. React Strict Mode runs every effect twice in
 * development; without a guard the second request would turn a successful
 * verification into an error. `startedFor` is a ref, which survives that
 * double run, so each token is sent once per mounted component.
 *
 * A missing token is an error from the first render — it is derived here, not
 * set from inside the effect.
 */
export function useTokenRequest(
  token: string | null,
  endpoint: string,
): TokenRequestStatus {
  const [outcome, setOutcome] = useState<{ token: string; ok: boolean } | null>(
    null,
  );
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token || startedFor.current === token) return;
    startedFor.current = token;
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => setOutcome({ token, ok: res.ok }))
      .catch(() => setOutcome({ token, ok: false }));
  }, [token, endpoint]);

  if (!token) return "error";
  if (outcome?.token !== token) return "pending";
  return outcome.ok ? "success" : "error";
}
