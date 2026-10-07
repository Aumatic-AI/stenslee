// Dev only: pre-compiles the SMS hook route so Supabase's 5s hook limit isn't hit on first login.
export function register() {
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_RUNTIME !== "nodejs") return;

  // Not awaited: register() must finish before the server accepts requests.
  setTimeout(() => {
    const port = process.env.PORT || "3000";
    fetch(`http://localhost:${port}/api/auth/send-whatsapp-otp`).catch(() => {});
  }, 1500);
}
