// Approval queue for brand-submitted events. Only emails listed in the
// ADMIN_EMAILS Netlify variable can use it.
//   GET  /api/admin            pending submissions (also used to check admin access)
//   POST /api/admin            { id, action: "approve" | "reject", note? }
import { flyerPublicUrl, isAdmin, serviceFetch, supabaseEnv, userFromRequest } from "../lib/supabase.mts";

export default async (request: Request) => {
  if (!supabaseEnv().ready) return Response.json({ error: "Accounts are not set up yet." }, { status: 503 });
  const user = await userFromRequest(request);
  if (!isAdmin(user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  if (request.method === "GET") {
    const response = await serviceFetch("/rest/v1/event_submissions?status=eq.pending&order=created_at.asc&select=*");
    if (!response.ok) return Response.json({ error: "Could not load submissions." }, { status: 502 });
    const rows = await response.json() as Array<Record<string, unknown>>;
    return Response.json({
      admin: true,
      submissions: rows.map((row) => ({ ...row, flyer_url: flyerPublicUrl(row.flyer_path as string) })),
    });
  }

  if (request.method === "POST") {
    let body: { id?: string; action?: string; note?: string };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
    const status = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "";
    if (!body.id || !status || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
    const response = await serviceFetch(`/rest/v1/event_submissions?id=eq.${body.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, review_note: String(body.note || "").slice(0, 300) || null, reviewed_at: new Date().toISOString() }),
    });
    if (!response.ok) return Response.json({ error: "Could not update that submission." }, { status: 502 });
    return Response.json({ ok: true, status });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config = { path: "/api/admin" };
