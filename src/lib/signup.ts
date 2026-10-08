// SERVER-ONLY — shared by the signup API routes and the Send SMS hook.

export const ALREADY_IN_STUDIO = "This number is already part of a studio on Stenslee.";

// How long a filled-in signup form lets that number receive a code and finish signing up.
export const SIGNUP_WINDOW_MS = 15 * 60 * 1000;

export function signupCutoffIso(): string {
  return new Date(Date.now() - SIGNUP_WINDOW_MS).toISOString();
}

// Supabase stores phones as plain digits (no "+"), so signup_requests is keyed the same way.
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
