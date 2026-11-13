// Push notifications for friends.
//   POST /api/push { action: "register", token }    save this phone for the signed-in person
//   POST /api/push { action: "unregister", token }  forget this phone (on sign out)
//   POST /api/push { action: "saved", eventKey }    tell friends this person saved an event
// "saved" only works for a save made in the last 10 minutes, and only once per
// save, so it can't be used to spam people.
import { isDeadToken, sendPush } from "../lib/apns.mts";
import { serviceFetch, supabaseEnv, userFromRequest } from "../lib/supabase.mts";

const TOKEN = /^[0-9a-f]{64,200}$/i;

async function rows(path: string): Promise<Array<Record<string, any>>> {
  const response = await serviceFetch(path);
  return response.ok ? await response.json() : [];
}

function formatDate(date: string): string {
  const [year, month, day] = String(date || "").split("-").map(Number);
  if (!year) return "";
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default async (request: Request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!supabaseEnv().ready) return Response.json({ error: "Accounts are not set up yet." }, { status: 503 });
  const user = await userFromRequest(request);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });

  let body: { action?: string; token?: string; eventKey?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  if (body.action === "register" || body.action === "unregister") {
    const token = String(body.token || "").trim();
    if (!TOKEN.test(token)) return Response.json({ error: "Bad token" }, { status: 400 });
    if (body.action === "unregister") {
      await serviceFetch(`/rest/v1/device_tokens?token=eq.${token}&user_id=eq.${user.id}`, { method: "DELETE" });
      return Response.json({ ok: true });
    }
    const response = await serviceFetch("/rest/v1/device_tokens?on_conflict=token", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ token, user_id: user.id, platform: "ios", updated_at: new Date().toISOString() }),
    });
    return Response.json({ ok: response.ok }, { status: response.ok ? 200 : 502 });
  }

  if (body.action === "saved") {
    const key = String(body.eventKey || "");
    if (!key || key.length > 300) return Response.json({ error: "Bad request" }, { status: 400 });

    const [saved] = await rows(`/rest/v1/saved_events?user_id=eq.${user.id}&event_key=eq.${encodeURIComponent(key)}&select=event,created_at,notified_at`);
    if (!saved || saved.notified_at || Date.now() - new Date(saved.created_at).getTime() > 10 * 60 * 1000) {
      return Response.json({ ok: true, sent: 0 });
    }
    // Mark it first so a double tap can't notify twice.
    await serviceFetch(`/rest/v1/saved_events?user_id=eq.${user.id}&event_key=eq.${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    });

    const [me] = await rows(`/rest/v1/profiles?id=eq.${user.id}&select=display_name,brand_name,username,share_activity`);
    if (!me?.share_activity) return Response.json({ ok: true, sent: 0 });

    const [following, followers, blockedMe] = await Promise.all([
      rows(`/rest/v1/follows?follower_id=eq.${user.id}&select=creator_id`),
      rows(`/rest/v1/follows?creator_id=eq.${user.id}&select=follower_id`),
      rows(`/rest/v1/blocks?blocked_id=eq.${user.id}&select=blocker_id`),
    ]);
    const iFollow = new Set(following.map((row) => row.creator_id));
    const blockers = new Set(blockedMe.map((row) => row.blocker_id));
    const friends = followers.map((row) => row.follower_id).filter((id) => iFollow.has(id) && !blockers.has(id));
    if (!friends.length) return Response.json({ ok: true, sent: 0 });

    const tokens = await rows(`/rest/v1/device_tokens?user_id=in.(${friends.join(",")})&select=token`);
    const name = me.display_name || me.brand_name || (me.username ? `@${me.username}` : "A friend");
    const event = saved.event || {};
    const venue = String(event.location || "").split(",")[0];
    const results = await sendPush(tokens.map((row) => row.token), {
      title: `${name} saved an event`,
      body: [event.title, [formatDate(event.date), venue].filter(Boolean).join(" / ")].filter(Boolean).join("\n"),
      data: { eventKey: key, kind: "friend-saved" },
    });

    const dead = results.filter(isDeadToken).map((result) => result.token);
    if (dead.length) await serviceFetch(`/rest/v1/device_tokens?token=in.(${dead.join(",")})`, { method: "DELETE" });
    const failed = results.filter((result) => !result.ok && !isDeadToken(result));
    if (failed.length) console.error("Some pushes failed", failed.map((result) => `${result.status} ${result.reason || ""}`).join(", "));
    return Response.json({ ok: true, sent: results.filter((result) => result.ok).length });
  }

  return Response.json({ error: "Bad request" }, { status: 400 });
};

export const config = { path: "/api/push" };
