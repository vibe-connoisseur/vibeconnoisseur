// Permanently deletes the signed-in person's account. Profile, saved events
// and submissions are removed with it (the tables cascade on delete).
import { serviceFetch, supabaseEnv, userFromRequest } from "../lib/supabase.mts";

export default async (request: Request) => {
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
