"use client";

import { useEffect, useId, useRef } from "react";
import Script from "next/script";

declare global {
  interface Window {
    grecaptcha?: {
      render: (
        container: HTMLElement,
        params: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        }
      ) => number;
      reset: (widgetId?: number) => void;
    };
    // Called by the script tag's `onload=` query param once grecaptcha is
    // ready — explicit-render mode (as opposed to the auto-rendering
    // `class="g-recaptcha"` div) so this works reliably with React's
    // render lifecycle instead of racing it.
    __onRecaptchaLoad?: () => void;
  }
}

/**
 * Renders nothing if `siteKey` is empty — the same "absent config means
 * this feature just isn't part of the page" pattern used for CILogon
 * (web-gateway/frontend/lib/auth.ts's cilogonProvider()). Registration stays usable
 * without a Google account; see web-gateway/backend/app/services/recaptcha.py for the
 * matching server-side skip.
 */
export function Recaptcha({
  siteKey,
  onVerify,
}: {
  siteKey: string;
  onVerify: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<number | null>(null);
  const reactId = useId();

  // The widget is rendered once per siteKey; it must not be torn down and
  // rebuilt just because the parent passed a new callback identity. The widget
  // calls through this ref, so it always reaches the latest onVerify.
  const onVerifyRef = useRef(onVerify);
  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);

  useEffect(() => {
    if (!siteKey) return;

    function render() {
      const container = containerRef.current;
      if (!container || !window.grecaptcha) return;
      // grecaptcha refuses to render twice into the same element, and in
      // practice this effect does run more than once per mount in dev (Fast
      // Refresh / Strict Mode) — a flag on the container isn't a reliable
      // enough guard against that. Instead, always render into a brand-new
      // child node: clear out anything left from a prior call, then hand
      // grecaptcha a target it has never seen before, so "already rendered"
      // can't happen regardless of how many times render() fires.
      container.innerHTML = "";
      const target = document.createElement("div");
      container.appendChild(target);
      widgetId.current = window.grecaptcha.render(target, {
        sitekey: siteKey,
        callback: (token) => onVerifyRef.current(token),
        "expired-callback": () => onVerifyRef.current(null),
      });
    }

    if (window.grecaptcha) {
      render();
    } else {
      window.__onRecaptchaLoad = render;
    }
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <>
      <Script
        src="https://www.google.com/recaptcha/api.js?render=explicit&onload=__onRecaptchaLoad"
        strategy="afterInteractive"
      />
      <div id={`recaptcha-${reactId}`} ref={containerRef} />
    </>
  );
}
