// Approvals for the admin team. Only emails listed in the ADMIN_EMAILS
// Netlify variable can use it.
//   GET  /api/admin                      everything waiting for review
//   GET  /api/admin?view=creators        every Brand and DJ approved or declined
//   GET  /api/admin?view=events          uploaded events (approved and rejected)
//   GET  /api/admin?view=log             history of every admin action
//   GET  /api/admin?view=profile&id=...  one profile, to edit it
//   POST /api/admin   { kind, id, action, note?, fields? }
//     kind "submission": "approve" | "reject" | "delete"
//     kind "creator":    "approve" | "reject"
//     kind "edit":       "approve" | "reject"   (profile changes from a Brand or DJ)
//     kind "profile":    "update"               (your own edit, fields = { ... })
//     kind "account":    "delete"
//     kind "post":       "delete"
//     kind "report":     "remove" (delete the reported post) | "dismiss"
import { flyerPublicUrl, isAdmin, mediaPublicUrl, serviceFetch, supabaseEnv, userFromRequest } from "../lib/supabase.mts";

const UUID = /^[0-9a-f-]{36}$/i;
const CREATOR_COLUMNS = "id,display_name,brand_name,username,account_type,instagram,bio,avatar_path,creator_status,creator_reviewed_at,created_at,updated_at";
// Fields that can be changed by an approved edit or by you.
const EDITABLE: Record<string, number> = { display_name: 60, brand_name: 80, username: 30, bio: 300, instagram: 100, avatar_path: 300, account_type: 5 };

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
  if (!response.ok) console.error("Admin update failed", path.split("?")[0], response.status, (await response.text()).slice(0, 200));
  return response.ok;
}

async function remove(path: string) {
  const response = await serviceFetch(path, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!response.ok) console.error("Admin delete failed", path.split("?")[0], response.status);
  return response.ok;
}

async function log(kind: string, action: string, targetId: string | null, title: string, detail: Record<string, unknown> = {}) {
  const response = await serviceFetch("/rest/v1/admin_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ kind, action, target_id: targetId, title: title.slice(0, 200), detail }),
  });
  if (!response.ok) console.error("Admin log failed (run supabase/6-admin.sql)", response.status);
}

function profileName(row: Record<string, any> | undefined) {
  return row ? row.brand_name || row.display_name || (row.username ? `@${row.username}` : "Account") : "Account";
}

// Tidies changed fields and drops anything that isn't allowed.
function cleanFields(input: Record<string, unknown>) {
  const out: Record<string, string | null> = {};
  for (const [key, max] of Object.entries(EDITABLE)) {
    if (!(key in input)) continue;
    let value = input[key] == null ? "" : String(input[key]).trim();
    if (key === "username") value = value.toLowerCase().replace(/^@/, "");
    if (key === "instagram") {
      value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "");
      value = value ? `@${value.slice(0, 30)}` : "";
    }
    if (key === "account_type" && !["fan", "brand", "dj"].includes(value)) continue;
    out[key] = value ? value.slice(0, max) : null;
  }
  if (out.username && !/^[a-z0-9._]{3,30}$/.test(out.username)) throw new Error("Usernames are 3 to 30 letters, numbers, dots or underscores.");
  return out;
}

export default async (request: Request) => {
  if (!supabaseEnv().ready) return Response.json({ error: "Accounts are not set up yet." }, { status: 503 });
  const user = await userFromRequest(request);
  // 401 = the login itself wasn't accepted (the app renews it and retries);
  // 403 = a real login that isn't on the admin list.
  if (!user) return Response.json({ error: "Please sign in again" }, { status: 401 });
  if (!isAdmin(user)) {
    console.error("Admin refused: this account's email is not in ADMIN_EMAILS", user.id, (user.email || "").replace(/^(.).*@/, "$1***@"));
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }

  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const view = params.get("view") || "";

    if (view === "creators") {
      const rows = await list(`/rest/v1/profiles?creator_status=in.(approved,rejected)&account_type=in.(brand,dj)&order=creator_reviewed_at.desc.nullslast,updated_at.desc&limit=500&select=${CREATOR_COLUMNS}`);
      return Response.json({ creators: rows.map((row) => ({ ...row, avatar_url: mediaPublicUrl(row.avatar_path) })) });
    }
    if (view === "events") {
      const rows = await list("/rest/v1/event_submissions?status=in.(approved,rejected)&order=event_date.desc&limit=300&select=*");
      return Response.json({ events: rows.map((row) => ({ ...row, flyer_url: flyerPublicUrl(row.flyer_path) })) });
    }
    if (view === "log") {
      const rows = await list("/rest/v1/admin_log?order=created_at.desc&limit=300&select=*");
      return Response.json({ log: rows });
    }
    if (view === "profile") {
      const id = params.get("id") || "";
      if (!UUID.test(id)) return Response.json({ error: "Bad request" }, { status: 400 });
      const [row] = await list(`/rest/v1/profiles?id=eq.${id}&select=${CREATOR_COLUMNS}`);
      if (!row) return Response.json({ error: "Profile not found" }, { status: 404 });
      return Response.json({ profile: { ...row, avatar_url: mediaPublicUrl(row.avatar_path) } });
    }

    const [submissions, creators, reports, edits] = await Promise.all([
      list("/rest/v1/event_submissions?status=eq.pending&order=created_at.asc&select=*"),
      list(`/rest/v1/profiles?creator_status=eq.pending&account_type=in.(brand,dj)&order=updated_at.asc&select=${CREATOR_COLUMNS}`),
      list("/rest/v1/reports?status=eq.open&order=created_at.asc&select=id,reason,created_at,post_id,profile_id,posts(id,caption,media,creator_id),profiles(id,username,display_name,brand_name)"),
      list("/rest/v1/profile_edits?status=eq.pending&order=created_at.asc&select=*"),
    ]);
    const editOwners = edits.length
      ? await list(`/rest/v1/profiles?id=in.(${edits.map((row) => row.user_id).join(",")})&select=${CREATOR_COLUMNS}`)
      : [];
    const owners = new Map(editOwners.map((row) => [row.id, row]));
    return Response.json({
      admin: true,
      submissions: submissions.map((row) => ({ ...row, flyer_url: flyerPublicUrl(row.flyer_path) })),
      creators: creators.map((row) => ({ ...row, avatar_url: mediaPublicUrl(row.avatar_path) })),
      edits: edits.map((row) => {
        const current = owners.get(row.user_id) || {};
        return {
          ...row,
          current: { ...current, avatar_url: mediaPublicUrl(current.avatar_path) },
          new_avatar_url: row.changes?.avatar_path ? mediaPublicUrl(row.changes.avatar_path) : "",
        };
      }),
      reports: reports.map((row) => ({
        ...row,
        preview_url: row.posts?.media?.[0] ? mediaPublicUrl(row.posts.media[0].poster || row.posts.media[0].path) : "",
      })),
    });
  }

  if (request.method === "POST") {
    let body: { kind?: string; id?: string; action?: string; note?: string; fields?: Record<string, unknown> };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
    const kind = body.kind || "submission";
    const id = String(body.id || "");
    if (!UUID.test(id)) return Response.json({ error: "Bad request" }, { status: 400 });
    const note = String(body.note || "").slice(0, 300) || null;
    const now = new Date().toISOString();
    let ok = false;

    if (kind === "submission" && (body.action === "approve" || body.action === "reject")) {
      const [row] = await list(`/rest/v1/event_submissions?id=eq.${id}&select=title,event_date`);
      ok = await patch(`/rest/v1/event_submissions?id=eq.${id}`, {
        status: body.action === "approve" ? "approved" : "rejected",
        review_note: note,
        reviewed_at: now,
      });
      if (ok) await log("event", body.action === "approve" ? "approved" : "declined", id, row?.title || "Event", { date: row?.event_date, note });
    } else if (kind === "submission" && body.action === "delete") {
      const [row] = await list(`/rest/v1/event_submissions?id=eq.${id}&select=title,event_date,status,flyer_path`);
      ok = await remove(`/rest/v1/event_submissions?id=eq.${id}`);
      if (ok && row?.flyer_path) await serviceFetch(`/storage/v1/object/flyers/${row.flyer_path}`, { method: "DELETE" });
      if (ok) await log("event", "deleted", id, row?.title || "Event", { date: row?.event_date, was: row?.status });
    } else if (kind === "creator" && (body.action === "approve" || body.action === "reject")) {
      const [row] = await list(`/rest/v1/profiles?id=eq.${id}&select=${CREATOR_COLUMNS}`);
      ok = await patch(`/rest/v1/profiles?id=eq.${id}`, {
        creator_status: body.action === "approve" ? "approved" : "rejected",
        creator_reviewed_at: now,
      });
      if (ok) await log("creator", body.action === "approve" ? "approved" : "declined", id, profileName(row), { type: row?.account_type, username: row?.username, note });
    } else if (kind === "edit" && (body.action === "approve" || body.action === "reject")) {
      const [edit] = await list(`/rest/v1/profile_edits?id=eq.${id}&status=eq.pending&select=*`);
      if (!edit) return Response.json({ error: "That change was already reviewed." }, { status: 409 });
      const [owner] = await list(`/rest/v1/profiles?id=eq.${edit.user_id}&select=${CREATOR_COLUMNS}`);
      if (body.action === "approve") {
        let fields: Record<string, string | null>;
        try {
          fields = cleanFields(edit.changes || {});
        } catch (error) {
          return Response.json({ error: (error as Error).message }, { status: 400 });
        }
        ok = Object.keys(fields).length === 0 || await patch(`/rest/v1/profiles?id=eq.${edit.user_id}`, { ...fields, updated_at: now });
        if (!ok) return Response.json({ error: "Couldn't apply that change. The username may already be taken." }, { status: 409 });
      } else {
        ok = true;
      }
      if (ok) ok = await patch(`/rest/v1/profile_edits?id=eq.${id}`, { status: body.action === "approve" ? "approved" : "rejected", review_note: note, reviewed_at: now });
      if (ok) await log("edit", body.action === "approve" ? "approved" : "declined", edit.user_id, profileName(owner), { changes: edit.changes, note });
    } else if (kind === "profile" && body.action === "update") {
      let fields: Record<string, string | null>;
      try {
        fields = cleanFields(body.fields || {});
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
      }
      if (!Object.keys(fields).length) return Response.json({ error: "Nothing to change." }, { status: 400 });
      const [before] = await list(`/rest/v1/profiles?id=eq.${id}&select=${CREATOR_COLUMNS}`);
      ok = await patch(`/rest/v1/profiles?id=eq.${id}`, { ...fields, updated_at: now });
      if (!ok) return Response.json({ error: "Couldn't save. The username may already be taken." }, { status: 409 });
      await log("profile", "edited", id, profileName({ ...before, ...fields }), { changes: fields });
    } else if (kind === "account" && body.action === "delete") {
      const [row] = await list(`/rest/v1/profiles?id=eq.${id}&select=${CREATOR_COLUMNS}`);
      const response = await serviceFetch(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
      ok = response.ok;
      if (!ok) console.error("Admin account delete failed", response.status, (await response.text()).slice(0, 200));
      if (ok) await log("account", "deleted", id, profileName(row), { username: row?.username, type: row?.account_type });
    } else if (kind === "post" && body.action === "delete") {
      const [post] = await list(`/rest/v1/posts?id=eq.${id}&select=id,caption,media,creator_id`);
      if (!post) return Response.json({ error: "That post was already removed." }, { status: 404 });
      ok = await remove(`/rest/v1/posts?id=eq.${id}`);
      const paths = (post.media || []).flatMap((item: Record<string, string>) => [item.path, item.poster]).filter(Boolean);
      if (ok && paths.length) {
        await serviceFetch("/storage/v1/object/media", { method: "DELETE", body: JSON.stringify({ prefixes: paths }) });
      }
      if (ok) await log("post", "deleted", id, String(post.caption || "Post").slice(0, 80));
    } else if (kind === "report" && body.action === "dismiss") {
      ok = await patch(`/rest/v1/reports?id=eq.${id}`, { status: "resolved" });
      if (ok) await log("report", "kept", id, "Reported content kept");
    } else if (kind === "report" && body.action === "remove") {
      const [report] = await list(`/rest/v1/reports?id=eq.${id}&select=post_id`);
      if (report?.post_id) ok = await remove(`/rest/v1/posts?id=eq.${report.post_id}`);
      if (ok) await patch(`/rest/v1/reports?post_id=eq.${report.post_id}`, { status: "resolved" });
      if (ok) await log("report", "removed", report.post_id, "Reported post removed");
    } else {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }

    if (!ok) return Response.json({ error: "Could not update that. Try again." }, { status: 502 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config = { path: "/api/admin" };
