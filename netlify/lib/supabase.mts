// Shared helpers for the functions that talk to Supabase.
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in Netlify.

export type SupabaseUser = { id: string; email?: string };

export function supabaseEnv() {
  const url = (Netlify.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const anonKey = Netlify.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { url, anonKey, serviceKey, ready: Boolean(url && anonKey && serviceKey) };
}

export function adminEmails(): string[] {
  return (Netlify.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// Checks the sign-in token the app sends and returns who it belongs to.
export async function userFromRequest(request: Request): Promise<SupabaseUser | null> {
  const { url, anonKey } = supabaseEnv();
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!url || !anonKey || !token) return null;
  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const user = await response.json() as SupabaseUser;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

export function isAdmin(user: SupabaseUser | null): boolean {
  return Boolean(user?.email && adminEmails().includes(user.email.toLowerCase()));
}

export async function serviceFetch(path: string, init: RequestInit = {}) {
  const { url, serviceKey } = supabaseEnv();
  // Older "service_role" keys are JWTs and also go in Authorization. Newer
  // "sb_secret_" keys only go in the apikey header.
  const isJwt = serviceKey.startsWith("eyJ");
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      ...(isJwt ? { Authorization: `Bearer ${serviceKey}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export function flyerPublicUrl(path: string | null | undefined): string {
  const { url } = supabaseEnv();
  if (!path || !url) return "";
  return `${url}/storage/v1/object/public/flyers/${path.split("/").map(encodeURIComponent).join("/")}`;
}
