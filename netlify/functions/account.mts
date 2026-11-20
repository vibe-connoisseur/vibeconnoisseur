// Permanently deletes the signed-in person's account. Profile, saved events
// and submissions are removed with it (the tables cascade on delete).
import { serviceFetch, supabaseEnv, userFromRequest } from "../lib/supabase.mts";

export default async (request: Request) => {
  // Sign-in diagnostics: the app reports why someone was signed out without
  // tapping Sign out, so the cause shows in Netlify > Logs > Functions > account.
  if (request.method === "POST") {
    let body: { action?: string; event?: string; detail?: string } = {};
    try { body = await request.json(); } catch {}
    if (body.action === "diag") {
      console.error("Login diag", String(body.event || "").slice(0, 40), String(body.detail || "").slice(0, 300));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (request.method !== "DELETE") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!supabaseEnv().ready) return Response.json({ error: "Accounts are not set up yet." }, { status: 503 });

  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Sign in again, then try deleting your account." }, { status: 401 });

  const response = await serviceFetch(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
  if (!response.ok) {
    console.error("Account delete failed", response.status, await response.text());
    return Response.json({ error: "Your account could not be deleted. Try again or email us." }, { status: 502 });
  }
  return Response.json({ ok: true });
};

export const config = { path: "/api/account" };
