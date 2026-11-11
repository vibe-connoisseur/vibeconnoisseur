// Approvals for the admin team. Only emails listed in the ADMIN_EMAILS
// Netlify variable can use it.
//   GET  /api/admin   pending event submissions, Brand/DJ applications and open reports
//   POST /api/admin   { kind, id, action, note? }
//     kind "submission": action "approve" | "reject"
//     kind "creator":    action "approve" | "reject"
//     kind "report":     action "remove" (delete the reported post) | "dismiss"
import { flyerPublicUrl, isAdmin, mediaPublicUrl, serviceFetch, supabaseEnv, userFromRequest } from "../lib/supabase.mts";

const UUID = /^[0-9a-f-]{36}$/i;

async function list(path: string) {
  const response = await serviceFetch(path);
  if (!response.ok) {
    console.error("Admin list failed", path.split("?")[0], response.status);
    return [];
  }
  return await response.json() as Array<Record<string, any>>;
}

async function patch(path: string, body: Record<string, unknown>) {
  const response = await serviceFetch(path, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
  return response.ok;
}

export default async (request: Request) => {
  if (!supabaseEnv().ready) return Response.json({ error: "Accounts are not set up yet." }, { status: 503 });
  const user = await userFromRequest(request);
  if (!isAdmin(user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  if (request.method === "GET") {
    const [submissions, creators, reports] = await Promise.all([
      list("/rest/v1/event_submissions?status=eq.pending&order=created_at.asc&select=*"),
      list("/rest/v1/profiles?creator_status=eq.pending&account_type=in.(brand,dj)&order=updated_at.asc&select=id,display_name,brand_name,username,account_type,instagram,bio,avatar_path,updated_at"),
      list("/rest/v1/reports?status=eq.open&order=created_at.asc&select=id,reason,created_at,post_id,profile_id,posts(id,caption,media,creator_id),profiles(id,username,display_name,brand_name)"),
    ]);
    return Response.json({
      admin: true,
      submissions: submissions.map((row) => ({ ...row, flyer_url: flyerPublicUrl(row.flyer_path) })),
      creators: creators.map((row) => ({ ...row, avatar_url: mediaPublicUrl(row.avatar_path) })),
      reports: reports.map((row) => ({
        ...row,
        preview_url: row.posts?.media?.[0] ? mediaPublicUrl(row.posts.media[0].poster || row.posts.media[0].path) : "",
      })),
    });
  }

  if (request.method === "POST") {
    let body: { kind?: string; id?: string; action?: string; note?: string };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
    const kind = body.kind || "submission";
    if (!body.id || !UUID.test(body.id)) return Response.json({ error: "Bad request" }, { status: 400 });
    const note = String(body.note || "").slice(0, 300) || null;
    let ok = false;

    if (kind === "submission" && (body.action === "approve" || body.action === "reject")) {
      ok = await patch(`/rest/v1/event_submissions?id=eq.${body.id}`, {
        status: body.action === "approve" ? "approved" : "rejected",
        review_note: note,
        reviewed_at: new Date().toISOString(),
      });
    } else if (kind === "creator" && (body.action === "approve" || body.action === "reject")) {
      ok = await patch(`/rest/v1/profiles?id=eq.${body.id}`, { creator_status: body.action === "approve" ? "approved" : "rejected" });
    } else if (kind === "report" && body.action === "dismiss") {
      ok = await patch(`/rest/v1/reports?id=eq.${body.id}`, { status: "resolved" });
    } else if (kind === "report" && body.action === "remove") {
      const [report] = await list(`/rest/v1/reports?id=eq.${body.id}&select=post_id`);
      if (report?.post_id) {
        const response = await serviceFetch(`/rest/v1/posts?id=eq.${report.post_id}`, { method: "DELETE" });
        ok = response.ok;
      }
      if (ok) await patch(`/rest/v1/reports?post_id=eq.${report.post_id}`, { status: "resolved" });
    } else {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }

    if (!ok) return Response.json({ error: "Could not update that. Try again." }, { status: 502 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config = { path: "/api/admin" };
