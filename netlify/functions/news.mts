// Vibe News: the latest posts from the TVC Instagram account, sorted into
// Hot topics, Event news and Concert news by hashtag.
//   #vibenews / #hottopic     -> Hot topics
//   #eventnews                -> Event news
//   #concertnews              -> Concert news
// Posts without one of these tags are left out, unless nothing is tagged
// yet, in which case the latest posts show as "Latest".
//
// Needs IG_ACCESS_TOKEN in Netlify (see INSTAGRAM-SETUP.md). Two kinds work:
// - Meta's newer "Unified login" token, plus IG_USER_ID (the Instagram
//   account ID shown next to the account). Reads graph.facebook.com.
//   Use a token that never expires (system user) where Meta offers one.
// - An older Instagram Login token (starts with "IG"), no IG_USER_ID needed.
//   It lasts 60 days, so this function swaps it for a fresh one every week
//   and keeps it in Netlify Blobs.
import { getStore } from "@netlify/blobs";

type Category = "hot" | "events" | "concerts" | "latest";
type NewsItem = {
  id: string;
  category: Category;
  title: string;
  caption: string;
  image: string;
  type: string;
  permalink: string;
  timestamp: string;
};

const CACHE_MINUTES = 10;
const REFRESH_AFTER_DAYS = 7;
const TAGS: Array<[Category, RegExp]> = [
  ["concerts", /#concertnews\b/i],
  ["events", /#eventnews\b/i],
  ["hot", /#(vibenews|hottopics?)\b/i],
];

function store() {
  try {
    return getStore("vibe-news");
  } catch {
    return null;
  }
}

const GRAPH_VERSION = "v21.0";

function igUserId(): string {
  return (Netlify.env.get("IG_USER_ID") || "").trim();
}

// Instagram tokens start with "IG" and only work on graph.instagram.com.
// Facebook-style tokens (system user, Facebook login) use graph.facebook.com.
function isInstagramToken(token: string): boolean {
  return /^IG/.test(token);
}

function cleanToken(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
}

async function currentToken(blobs: ReturnType<typeof store>): Promise<string> {
  const envToken = cleanToken(Netlify.env.get("IG_ACCESS_TOKEN") || "");
  // Only Instagram tokens can be refreshed here. Facebook-style tokens are
  // managed in Meta's dashboard (system-user tokens never expire).
  if (!blobs || !isInstagramToken(envToken)) return envToken;
  let saved: { token: string; refreshedAt: number; source: string } | null = null;
  try {
    saved = await blobs.get("token", { type: "json" });
  } catch {
    saved = null;
  }
  // A new token pasted into Netlify replaces the saved one.
  let token = saved && saved.source === envToken.slice(-12) ? saved.token : envToken;
  const refreshedAt = saved && saved.source === envToken.slice(-12) ? saved.refreshedAt : 0;
  if (token && Date.now() - refreshedAt > REFRESH_AFTER_DAYS * 864e5) {
    try {
      const response = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
      const body = await response.json() as { access_token?: string };
      if (response.ok && body.access_token) {
        token = body.access_token;
        await blobs.setJSON("token", { token, refreshedAt: Date.now(), source: envToken.slice(-12) }).catch(() => undefined);
      }
    } catch (error) {
      console.error("Instagram token refresh failed", error instanceof Error ? error.message : "");
    }
  }
  return token;
}

function categorise(caption: string): Category | null {
  for (const [category, pattern] of TAGS) if (pattern.test(caption)) return category;
  return null;
}

function cleanCaption(caption: string): { title: string; text: string } {
  const text = caption.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/[ \t]+/g, " ").trim();
  const firstLine = text.split(/\n+/).map((line) => line.trim()).find(Boolean) || "";
  const title = firstLine.length > 110 ? `${firstLine.slice(0, 107).trim()}...` : firstLine;
  return { title, text: text.slice(0, 600) };
}

async function fetchNews(token: string): Promise<NewsItem[]> {
  // Posts with licensed music come back without media_url, so also ask for
  // the carousel's own photos and use the first one.
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}";
  const userId = igUserId();
  const url = isInstagramToken(token) || !userId
    ? `https://graph.instagram.com/${GRAPH_VERSION}/me/media?fields=${fields}&limit=40&access_token=${encodeURIComponent(token)}`
    : `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(userId)}/media?fields=${fields}&limit=40&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  const body = await response.json() as { data?: Array<Record<string, string>>; error?: { message?: string } };
  if (!response.ok || !Array.isArray(body.data)) throw new Error(body.error?.message || `Instagram returned ${response.status}`);

  const posts = (body.data as Array<Record<string, any>>).map((post) => {
    const children: Array<Record<string, string>> = post.children?.data || [];
    const child = children.map((item) => item.media_type === "VIDEO" ? item.thumbnail_url : item.media_url).find(Boolean) || "";
    const caption = post.caption || "";
    const { title, text } = cleanCaption(caption);
    return {
      id: post.id,
      category: categorise(caption),
      title,
      caption: text,
      image: (post.media_type === "VIDEO" ? post.thumbnail_url : post.media_url) || post.thumbnail_url || child || "",
      type: post.media_type || "IMAGE",
      permalink: post.permalink || "",
      timestamp: post.timestamp || "",
    };
  }).filter((post) => post.permalink);

  const tagged = posts.filter((post) => post.category).slice(0, 24) as NewsItem[];
  if (tagged.length) return tagged;
  return posts.slice(0, 12).map((post) => ({ ...post, category: "latest" as Category }));
}

export default async () => {
  const blobs = store();
  const headers = { "Cache-Control": "public, max-age=300" };

  try {
    let cached: { at: number; items: NewsItem[] } | null = null;
    try {
      cached = blobs ? await blobs.get("feed", { type: "json" }) : null;
    } catch {
      cached = null;
    }
    if (cached && Date.now() - cached.at < CACHE_MINUTES * 60000) {
      return Response.json({ configured: true, items: cached.items }, { headers });
    }

    const token = await currentToken(blobs);
    if (!token) return Response.json({ configured: false, items: [] }, { headers });

    try {
      const items = await fetchNews(token);
      if (blobs) await blobs.setJSON("feed", { at: Date.now(), items }).catch(() => undefined);
      return Response.json({ configured: true, items }, { headers });
    } catch (error) {
      console.error("Vibe News fetch failed", error instanceof Error ? error.message : "");
      // Fall back to the last good copy rather than an empty section.
      return Response.json({ configured: true, items: cached?.items || [], stale: true }, { headers });
    }
  } catch (error) {
    console.error("Vibe News failed", error instanceof Error ? error.message : "");
    return Response.json({ configured: false, items: [] }, { status: 200, headers });
  }
};

export const config = { path: "/api/news" };
