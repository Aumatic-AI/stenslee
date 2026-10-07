// Reads the Supabase `session_id` claim from an access token.
export function getSessionId(accessToken?: string | null): string | null {
  try {
    const payload = accessToken?.split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).session_id ?? null;
  } catch {
    return null;
  }
}

// True when the account's latest login is a different session than this one.
export function isReplacedSession(currentSessionId: string | null | undefined, thisSessionId: string | null): boolean {
  return !!currentSessionId && !!thisSessionId && currentSessionId !== thisSessionId;
}
