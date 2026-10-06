"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const COOLDOWN_SECONDS = 60;

function storageKey(key: string) {
  return `otp_resend_until:${key}`;
}

// Persists the "resend allowed again at" timestamp in localStorage, keyed by
// phone number, so a page reload mid-cooldown resumes the correct remaining
// time instead of silently clearing it. Call start() right after a code is
// (re)sent; secondsLeft ticks down to 0 on its own, including on first
// mount if a previous cooldown is still running.
export function useResendCooldown(key: string) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = useCallback(() => {
    if (!key) { setSecondsLeft(0); return; }
    let until = 0;
    try {
      until = Number(localStorage.getItem(storageKey(key)) ?? 0);
    } catch {
      until = 0; // localStorage blocked (private mode) -- cooldown just won't persist
    }
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    setSecondsLeft(remaining);
    if (remaining <= 0 && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [key]);

  useEffect(() => {
    tick(); // resume immediately -- covers the reload-mid-cooldown case
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [tick]);

  function start() {
    if (!key) return;
    try {
      localStorage.setItem(storageKey(key), String(Date.now() + COOLDOWN_SECONDS * 1000));
    } catch {
      // ignore -- see tick()
    }
    tick();
    if (!intervalRef.current) intervalRef.current = setInterval(tick, 1000);
  }

  return { secondsLeft, start };
}
