// Brand and DJ profiles: following, followers and post counts, photo and
// video posts, the Following tab, plus report and block (Apple requires
// both for apps where people post).
(function () {
  const app = window.VibeApp;
  if (!app) return;
  const { safeText: esc, native } = app;

  const MAX_FILES = 10;
  const MAX_VIDEO_MB = 50;
  const MAX_VIDEO_SECONDS = 90;

  const social = {
    ready: false,
    creators: new Map(),
    byHandle: new Map(),
    follows: new Set(),
    blocks: new Set(),
    recentPosts: [],
  };

  const sheet = {
    overlay: document.querySelector("#sheetOverlay"),
    title: document.querySelector("#sheetTitle"),
    body: document.querySelector("#sheetBody"),
    back: document.querySelector("#sheetBack"),
    close: document.querySelector("#sheetClose"),
    stack: [],
  };

  const account = () => window.VibeAccount || {};
  const client = () => account().client || null;
  const me = () => account().session?.user || null;

  function mediaUrl(path) {
    return path && client() ? client().storage.from("media").getPublicUrl(path).data.publicUrl : "";
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  }

  function compact(number) {
    if (number >= 1e6) return `${(number / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    if (number >= 1e4) return `${Math.round(number / 1e3)}K`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
    return String(number);
  }

  function avatarMarkup(creator, size = "") {
    const url = mediaUrl(creator.avatar_path);
    return `<span class="avatar ${size}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" />` : esc((creator.name || "?").slice(0, 1).toUpperCase())}</span>`;
  }

  function typeLabel(creator) {
    return creator.account_type === "dj" ? "DJ" : "Brand";
  }

  function visible(creator) {
    return creator && !social.blocks.has(creator.id);
  }

  // ---------- data ----------

  async function load() {
    const db = client();
    if (!db) return;
    const { data } = await db.from("creator_profiles").select("*").order("followers_count", { ascending: false }).limit(500);
    social.creators = new Map((data || []).map((row) => [row.id, row]));
    social.byHandle = new Map();
    for (const creator of social.creators.values()) {
      if (creator.instagram) social.byHandle.set(creator.instagram.toLowerCase(), creator);
    }
    social.follows = new Set();
    social.blocks = new Set();
    if (me()) {
      const [follows, blocks] = await Promise.all([
        db.from("follows").select("creator_id"),
        db.from("blocks").select("blocked_id"),
      ]);
      social.follows = new Set((follows.data || []).map((row) => row.creator_id));
      social.blocks = new Set((blocks.data || []).map((row) => row.blocked_id));
    }
    await loadFriends();
    social.ready = true;
    document.dispatchEvent(new CustomEvent("vibe:following-changed"));
  }

  function creatorsForEvent(event) {
    return (event.instagram || []).map((handle) => social.byHandle.get(handle)).filter(visible);
  }

  function eventsForCreator(creator) {
    if (!creator?.instagram) return [];
    const today = app.todayString();
    return app.state.events
      .filter((event) => event.date >= today && (event.instagram || []).includes(creator.instagram))
      .sort((first, second) => first.date.localeCompare(second.date));
  }

  async function postsFor(creatorIds, limit = 30) {
    if (!client() || !creatorIds.length) return [];
    const { data } = await client().from("posts").select("*").in("creator_id", creatorIds).order("created_at", { ascending: false }).limit(limit);
    return (data || []).filter((post) => !social.blocks.has(post.creator_id));
  }

  // ---------- follow ----------

  function requireSignIn(reason) {
    if (me()) return true;
    if (!client()) {
      app.showToast("Accounts are coming soon.");
      return false;
    }
    app.showToast(reason);
    account().showView?.("signin");
    return false;
  }

  async function toggleFollow(creatorId, button) {
    if (!requireSignIn("Sign in to follow brands and DJs.")) return;
    if (creatorId === me().id) return;
    const following = social.follows.has(creatorId);
    native.haptic(following ? "LIGHT" : "MEDIUM");
    if (button) button.disabled = true;
    const request = following
      ? client().from("follows").delete().eq("creator_id", creatorId).eq("follower_id", me().id)
      : client().from("follows").insert({ follower_id: me().id, creator_id: creatorId });
    const { error } = await request;
    if (button) button.disabled = false;
    if (error) {
      app.showToast("Couldn't update that. Try again.");
      return;
    }
    const creator = social.creators.get(creatorId);
    if (following) {
      social.follows.delete(creatorId);
      if (creator) creator.followers_count = Math.max(0, creator.followers_count - 1);
    } else {
      social.follows.add(creatorId);
      if (creator) creator.followers_count += 1;
      app.showToast(`Following ${creator?.name || ""}. Their events show in Following.`);
    }
    document.querySelectorAll(`[data-follow="${CSS.escape(creatorId)}"]`).forEach((element) => {
      element.classList.toggle("is-following", !following);
      element.textContent = !following ? "Following" : "Follow";
    });
    document.querySelectorAll(`[data-followers="${CSS.escape(creatorId)}"]`).forEach((element) => {
      element.textContent = compact(creator?.followers_count || 0);
    });
    document.dispatchEvent(new CustomEvent("vibe:following-changed"));
  }

  function followButton(creator, extraClass = "") {
    if (me() && creator.id === me().id) return "";
    const following = social.follows.has(creator.id);
    return `<button type="button" class="follow-button ${following ? "is-following" : ""} ${extraClass}" data-follow="${esc(creator.id)}">${following ? "Following" : "Follow"}</button>`;
  }

  // ---------- event detail: who's behind it ----------

  app.hooks.detailExtras = (event) => {
    const creators = creatorsForEvent(event);
    const linked = new Set(creators.map((creator) => creator.instagram));
    const others = (event.instagram || []).filter((handle) => !linked.has(handle));
    if (!creators.length && !others.length) return "";
    return `<div class="detail-hosts">
      <p class="detail-label">Hosted by</p>
      ${creators.map((creator) => `<div class="host-row">
        <button type="button" class="host-open" data-profile="${esc(creator.id)}">${avatarMarkup(creator)}<span><strong>${esc(creator.name)}</strong><small>${typeLabel(creator)} / @${esc(creator.username)}</small></span></button>
        ${followButton(creator, "is-small")}
      </div>`).join("")}
      ${others.map((handle) => `<a class="host-ig" href="https://www.instagram.com/${esc(handle)}/" target="_blank" rel="noopener noreferrer">@${esc(handle)} ${app.iconSvg("arrow-up-right")}</a>`).join("")}
    </div>`;
  };

  // ---------- Following tab ----------

  function creatorCard(creator) {
    return `<div class="creator-card">
      <button type="button" class="creator-open" data-profile="${esc(creator.id)}">
        ${avatarMarkup(creator, "avatar-md")}
        <span><strong>${esc(creator.name)}</strong><small>${typeLabel(creator)} / <b data-followers="${esc(creator.id)}">${compact(creator.followers_count)}</b> followers</small></span>
      </button>
      ${followButton(creator, "is-small")}
    </div>`;
  }

  function postTile(post) {
    const first = post.media?.[0] || {};
    const thumb = mediaUrl(first.poster || (first.type === "image" ? first.path : ""));
    const creator = social.creators.get(post.creator_id);
    return `<button type="button" class="post-tile" data-post="${esc(post.id)}" aria-label="Post by ${esc(creator?.name || "")}">
      ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" />` : '<span class="post-tile-blank"></span>'}
      ${first.type === "video" ? `<span class="post-badge">${app.iconSvg("play")}</span>` : post.media.length > 1 ? `<span class="post-badge">${app.iconSvg("stack")}</span>` : ""}
    </button>`;
  }

  const postCache = new Map();

  async function renderFollowing(container) {
    const views = window.VibeViews;
    if (!client()) {
      container.innerHTML = views.emptyFeed("Following is coming soon", "Soon you'll be able to follow your favourite brands and DJs and see their events here.");
      return;
    }
    if (!social.ready) {
      container.innerHTML = '<p class="drawer-fine feed-loading">Loading...</p>';
      return;
    }
    const all = [...social.creators.values()].filter(visible);
    const followed = all.filter((creator) => social.follows.has(creator.id));
    const handles = new Set(followed.map((creator) => creator.instagram).filter(Boolean));
    const today = app.todayString();
    const events = app.state.events
      .filter((event) => event.date >= today && (event.instagram || []).some((handle) => handles.has(handle)))
      .sort((first, second) => first.date.localeCompare(second.date));
    const suggestions = all.filter((creator) => !social.follows.has(creator.id) && (!me() || creator.id !== me().id));

    container.innerHTML = `
      ${friendsSection()}
      ${!me() ? `<div class="following-intro">
        <h2>Follow your favourite brands and DJs</h2>
        <p>Their events and posts land here, so you never miss the next one.</p>
        <button type="button" class="drawer-primary" data-signin><span>Sign in to follow</span><span>&rarr;</span></button>
      </div>` : ""}
      ${followed.length ? `
        ${views.sectionHead("You follow", followed.length)}
        <div class="following-row">${followed.map((creator) => `<button type="button" class="following-chip" data-profile="${esc(creator.id)}">${avatarMarkup(creator, "avatar-md")}<span>${esc(creator.name)}</span></button>`).join("")}</div>
        ${views.sectionHead("Their events", events.length)}
        ${events.length ? views.groupedFeed(events) : views.emptyFeed("No upcoming events yet", "When the brands and DJs you follow have events on the map, they'll show here.")}
        ${views.sectionHead("Latest posts")}
        <div class="post-grid" id="followingPosts"><p class="drawer-fine">Loading posts...</p></div>`
      : me() ? views.emptyFeed("You're not following anyone yet", "Follow brands and DJs below to see their events and posts here.") : ""}
      ${views.sectionHead(followed.length ? "More brands and DJs" : "Brands and DJs", suggestions.length)}
      ${suggestions.length ? `<label class="creator-search"><span class="sr-only">Search brands and DJs</span><input type="search" id="creatorSearch" placeholder="Search brands and DJs" autocomplete="off" /></label>
        <div class="creator-list" id="creatorList">${suggestions.map(creatorCard).join("")}</div>`
      : '<p class="drawer-fine">More brands and DJs are joining soon.</p>'}`;

    markActivitySeen();
    if (followed.length) {
      const posts = await postsFor(followed.map((creator) => creator.id), 30);
      posts.forEach((post) => postCache.set(post.id, post));
      const grid = container.querySelector("#followingPosts");
      if (grid) grid.innerHTML = posts.length ? posts.map(postTile).join("") : '<p class="drawer-fine">No posts yet from who you follow.</p>';
    }
  }

  // ---------- sheet (profile, post, composer) ----------

  function openSheet(title, render, { push = false } = {}) {
    if (!push) sheet.stack = [];
    sheet.stack.push({ title, render });
    drawSheet();
    if (sheet.overlay.hidden) {
      sheet.overlay.hidden = false;
      document.body.classList.add("sheet-open");
      requestAnimationFrame(() => sheet.overlay.classList.add("show"));
    }
  }

  function drawSheet() {
    const top = sheet.stack[sheet.stack.length - 1];
    if (!top) return;
    sheet.title.textContent = top.title;
    sheet.back.hidden = sheet.stack.length < 2;
    sheet.body.scrollTop = 0;
    sheet.body.innerHTML = '<p class="drawer-fine sheet-loading">Loading...</p>';
    Promise.resolve(top.render(sheet.body)).catch((error) => {
      sheet.body.innerHTML = `<p class="drawer-fine sheet-loading">${esc(account().friendlyError?.(error) || "Something went wrong.")}</p>`;
    });
  }

  function closeSheet() {
    sheet.body.querySelectorAll("video").forEach((video) => video.pause());
    sheet.overlay.classList.remove("show");
    document.body.classList.remove("sheet-open");
    setTimeout(() => {
      sheet.overlay.hidden = true;
      sheet.body.innerHTML = "";
      sheet.stack = [];
    }, 220);
  }

  function sheetBack() {
    if (sheet.stack.length < 2) return closeSheet();
    sheet.body.querySelectorAll("video").forEach((video) => video.pause());
    sheet.stack.pop();
    drawSheet();
  }

  async function fetchCreator(idOrUsername) {
    const key = String(idOrUsername || "");
    const cached = social.creators.get(key) || [...social.creators.values()].find((creator) => creator.username === key.toLowerCase());
    if (cached) return cached;
    if (!client()) return null;
    const column = /^[0-9a-f-]{36}$/i.test(key) ? "id" : "username";
    const { data } = await client().from("creator_profiles").select("*").eq(column, key.toLowerCase()).maybeSingle();
    if (data) social.creators.set(data.id, data);
    return data;
  }

  function openProfile(idOrUsername, options = {}) {
    app.closeEventDetail?.();
    openSheet("Profile", async (body) => {
      const creator = await fetchCreator(idOrUsername);
      const mine = me() && (creator?.id === me().id || idOrUsername === me().id);
      if (!creator) {
        body.innerHTML = mine
          ? '<div class="feed-empty"><h3>Your profile is waiting for approval</h3><p>Once it\'s approved it goes public here and you can post.</p></div>'
          : '<div class="feed-empty"><h3>Profile not found</h3><p>It may have been removed.</p></div>';
        return;
      }
      if (social.blocks.has(creator.id)) {
        body.innerHTML = `<div class="feed-empty"><h3>You blocked ${esc(creator.name)}</h3><button type="button" class="drawer-secondary" data-unblock="${esc(creator.id)}">Unblock</button></div>`;
        return;
      }
      const [posts] = await Promise.all([postsFor([creator.id], 60)]);
      posts.forEach((post) => postCache.set(post.id, post));
      const events = eventsForCreator(creator);
      const views = window.VibeViews;
      body.innerHTML = `
        <header class="profile-head">
          ${avatarMarkup(creator, "avatar-xl")}
          <div class="profile-name">
            <p class="profile-type">${typeLabel(creator)}</p>
            <h2>${esc(creator.name)}</h2>
            <p class="profile-handle">@${esc(creator.username)}</p>
          </div>
        </header>
        <div class="profile-counts">
          <span><strong>${compact(creator.posts_count)}</strong>Posts</span>
          <span><strong data-followers="${esc(creator.id)}">${compact(creator.followers_count)}</strong>Followers</span>
          <span><strong>${compact(creator.following_count)}</strong>Following</span>
        </div>
        ${creator.bio ? `<p class="profile-bio">${esc(creator.bio)}</p>` : ""}
        <div class="profile-actions">
          ${mine
            ? `<button type="button" class="drawer-primary" data-compose><span>New post</span><span>+</span></button>
               <button type="button" class="drawer-secondary" data-edit-profile>Edit profile</button>`
            : `${followButton(creator, "is-wide")}
               <button type="button" class="drawer-secondary profile-more" data-more="${esc(creator.id)}" aria-label="More options">&middot;&middot;&middot;</button>`}
          ${creator.instagram ? `<a class="drawer-secondary" href="https://www.instagram.com/${esc(creator.instagram)}/" target="_blank" rel="noopener noreferrer">Instagram</a>` : ""}
        </div>
        <div class="profile-tabs" role="tablist">
          <button type="button" role="tab" class="is-active" data-profile-tab="posts" aria-selected="true">Posts</button>
          <button type="button" role="tab" data-profile-tab="events" aria-selected="false">Events ${events.length ? `(${events.length})` : ""}</button>
        </div>
        <div data-profile-panel="posts">
          ${posts.length ? `<div class="post-grid">${posts.map(postTile).join("")}</div>`
            : `<p class="drawer-fine profile-empty">${mine ? "Share your first photo or video." : "No posts yet."}</p>`}
        </div>
        <div data-profile-panel="events" hidden>
          ${events.length ? views.groupedFeed(events) : '<p class="drawer-fine profile-empty">No upcoming events on the map.</p>'}
        </div>`;
      sheet.title.textContent = `@${creator.username}`;
      if (options.tab === "events") body.querySelector('[data-profile-tab="events"]').click();
    }, options);
  }

  // ---------- posts ----------

  function openPost(postId) {
    const post = postCache.get(postId);
    if (!post) return;
    openSheet("Post", async (body) => {
      const creator = social.creators.get(post.creator_id) || await fetchCreator(post.creator_id);
      const mine = me() && post.creator_id === me().id;
      body.innerHTML = `
        <div class="post-view">
          <button type="button" class="host-open post-author" data-profile="${esc(post.creator_id)}">${creator ? avatarMarkup(creator) : ""}<span><strong>${esc(creator?.name || "")}</strong><small>${new Date(post.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</small></span></button>
          <div class="post-media ${post.media.length > 1 ? "is-carousel" : ""}">
            ${post.media.map((item) => item.type === "video"
              ? `<video src="${esc(mediaUrl(item.path))}" ${item.poster ? `poster="${esc(mediaUrl(item.poster))}"` : ""} controls playsinline preload="metadata"></video>`
              : `<img src="${esc(mediaUrl(item.path))}" alt="" loading="lazy" />`).join("")}
          </div>
          ${post.media.length > 1 ? `<p class="post-count">${plural(post.media.length, "item")}. Swipe to see more.</p>` : ""}
          ${post.caption ? `<p class="post-caption">${esc(post.caption)}</p>` : ""}
          <div class="post-actions">
            ${mine
              ? `<button type="button" class="drawer-danger" data-delete-post="${esc(post.id)}">Delete post</button>`
              : `<button type="button" class="drawer-secondary" data-report-post="${esc(post.id)}">Report</button>
                 <button type="button" class="drawer-secondary" data-block="${esc(post.creator_id)}">Block ${esc(creator?.name || "")}</button>`}
          </div>
        </div>`;
    }, { push: !sheet.overlay.hidden });
  }

  async function deletePost(postId, button) {
    if (!window.confirm("Delete this post?")) return;
    button.disabled = true;
    const post = postCache.get(postId);
    const { error } = await client().from("posts").delete().eq("id", postId);
    if (error) {
      button.disabled = false;
      app.showToast("Couldn't delete it. Try again.");
      return;
    }
    const paths = (post?.media || []).flatMap((item) => [item.path, item.poster]).filter(Boolean);
    if (paths.length) client().storage.from("media").remove(paths);
    const creator = social.creators.get(post?.creator_id);
    if (creator) creator.posts_count = Math.max(0, creator.posts_count - 1);
    app.showToast("Post deleted");
    if (sheet.stack.length > 1) {
      sheet.stack.pop();
      drawSheet();
    } else closeSheet();
  }

  async function report({ postId = null, profileId = null }) {
    if (!requireSignIn("Sign in to report something.")) return;
    const reason = window.prompt("What's wrong with it? (for example: offensive, spam, not a real event)", "");
    if (reason === null) return;
    if (reason.trim().length < 2) {
      app.showToast("Add a short reason so we can look into it.");
      return;
    }
    const { error } = await client().from("reports").insert({ reporter_id: me().id, post_id: postId, profile_id: profileId, reason: reason.trim().slice(0, 300) });
    app.showToast(error ? "Couldn't send the report. Try again." : "Thanks. We'll review it within 24 hours.");
  }

  async function block(creatorId) {
    if (!requireSignIn("Sign in to block accounts.")) return;
    const creator = social.creators.get(creatorId) || friends.people.get(creatorId);
    if (!window.confirm(`Block ${creator?.name || "this account"}? You won't see their posts, profile or activity.`)) return;
    const { error } = await client().from("blocks").insert({ blocker_id: me().id, blocked_id: creatorId });
    if (error && !/duplicate/i.test(error.message)) {
      app.showToast("Couldn't block them. Try again.");
      return;
    }
    social.blocks.add(creatorId);
    if (social.follows.has(creatorId)) {
      await client().from("follows").delete().eq("creator_id", creatorId).eq("follower_id", me().id);
      social.follows.delete(creatorId);
    }
    app.showToast("Blocked. You can unblock them in Settings.");
    closeSheet();
    await loadFriends();
    document.dispatchEvent(new CustomEvent("vibe:following-changed"));
  }

  async function unblock(creatorId) {
    await client().from("blocks").delete().eq("blocked_id", creatorId).eq("blocker_id", me().id);
    social.blocks.delete(creatorId);
    app.showToast("Unblocked");
    document.dispatchEvent(new CustomEvent("vibe:following-changed"));
  }

  function openBlocked() {
    openSheet("Blocked accounts", async (body) => {
      const missing = [...social.blocks].filter((id) => !social.creators.has(id) && !friends.people.has(id));
      if (missing.length) {
        const { data } = await client().from("people").select("*").in("id", missing);
        (data || []).forEach((person) => friends.people.set(person.id, person));
      }
      const blocked = [...social.blocks].map((id) => social.creators.get(id) || friends.people.get(id)).filter(Boolean);
      body.innerHTML = blocked.length
        ? `<div class="creator-list">${blocked.map((creator) => `<div class="creator-card">
            <span class="creator-open">${avatarMarkup(creator, "avatar-md")}<span><strong>${esc(creator.name)}</strong><small>@${esc(creator.username)}</small></span></span>
            <button type="button" class="follow-button is-small" data-unblock="${esc(creator.id)}">Unblock</button>
          </div>`).join("")}</div>`
        : '<p class="drawer-fine sheet-loading">You haven\'t blocked anyone.</p>';
    });
  }

  function profileMore(creatorId) {
    const creator = social.creators.get(creatorId);
    openSheet(creator?.name || "Options", (body) => {
      body.innerHTML = `<div class="post-actions is-stacked">
        <button type="button" class="drawer-secondary" data-share-profile="${esc(creatorId)}">Share profile</button>
        <button type="button" class="drawer-secondary" data-report-profile="${esc(creatorId)}">Report profile</button>
        <button type="button" class="drawer-danger" data-block="${esc(creatorId)}">Block ${esc(creator?.name || "")}</button>
      </div>`;
    }, { push: true });
  }

  // ---------- composer ----------

  // Reads a video's length and grabs a frame for the grid thumbnail. If the
  // device can't decode it, the video still uploads, just without a thumbnail.
  function videoInfo(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(result);
      };
      setTimeout(() => finish({ duration: video.duration || 0, poster: null }), 6000);
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 900 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
          canvas.width = Math.round((video.videoWidth || 720) * scale);
          canvas.height = Math.round((video.videoHeight || 1280) * scale);
          canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((poster) => finish({ duration: video.duration, poster }), "image/jpeg", 0.82);
        } catch {
          finish({ duration: video.duration, poster: null });
        }
      };
      video.onerror = () => finish({ duration: 0, poster: null });
      video.src = url;
    });
  }

  // Uploads to Supabase storage with progress. Uses the web view's own
  // XMLHttpRequest (in the app, the native HTTP layer would copy the whole file
  // across the bridge and report no progress).
  async function uploadMedia(path, blob, contentType, onProgress) {
    const acct = account();
    const { data } = await client().auth.getSession();
    const token = data?.session?.access_token;
    if (!acct.supabaseUrl || !token) return client().storage.from("media").upload(path, blob, { contentType });
    const web = window.CapacitorWebXMLHttpRequest;
    const xhr = web ? new web.fullObject() : new XMLHttpRequest();
    const call = (name, ...args) => (web ? web[name] : XMLHttpRequest.prototype[name]).call(xhr, ...args);
    return new Promise((resolve) => {
      xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve({ error: null });
        let message = "Upload failed. Try again.";
        try { message = JSON.parse(xhr.responseText).message || message; } catch {}
        resolve({ error: new Error(message) });
      };
      xhr.onerror = () => resolve({ error: new Error("Upload failed. Check your connection and try again.") });
      call("open", "POST", `${acct.supabaseUrl}/storage/v1/object/media/${path.split("/").map(encodeURIComponent).join("/")}`);
      call("setRequestHeader", "Authorization", `Bearer ${token}`);
      call("setRequestHeader", "apikey", acct.supabaseAnonKey);
      call("setRequestHeader", "Content-Type", contentType);
      call("setRequestHeader", "x-upsert", "false");
      call("setRequestHeader", "cache-control", "max-age=3600");
      call("send", blob);
    });
  }

  function openComposer() {
    if (!account().isApprovedCreator?.()) {
      app.showToast("Posting is for approved Brand and DJ profiles.");
      return;
    }
    let files = [];
    openSheet("New post", (body) => {
      body.innerHTML = `
        <form class="drawer-form composer" id="composerForm" novalidate>
          <label class="composer-pick">
            <input type="file" name="media" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple hidden />
            <span>+</span><strong>Add photos or videos</strong><small>Up to ${MAX_FILES}. Videos up to ${MAX_VIDEO_SECONDS} seconds and ${MAX_VIDEO_MB}MB.</small>
          </label>
          <div class="composer-previews" id="composerPreviews"></div>
          <label class="field"><span>Caption</span>
            <textarea name="caption" rows="4" maxlength="2200" placeholder="Say something about it"></textarea>
          </label>
          <button class="drawer-primary" type="submit"><span>Share post</span><span>&rarr;</span></button>
          <p class="form-error" role="alert"></p>
          <p class="drawer-fine">Posts are public. Keep them in line with the <a href="terms.html" target="_blank" rel="noopener">community rules</a>.</p>
        </form>`;
      const form = body.querySelector("#composerForm");
      const previews = body.querySelector("#composerPreviews");
      const errorElement = form.querySelector(".form-error");

      const drawPreviews = () => {
        previews.innerHTML = files.map((file, index) => `<span class="composer-preview">
          ${file.type.startsWith("video") ? `<video src="${URL.createObjectURL(file)}" muted playsinline></video><b>${app.iconSvg("play")}</b>` : `<img src="${URL.createObjectURL(file)}" alt="" />`}
          <button type="button" data-remove-file="${index}" aria-label="Remove">&times;</button>
        </span>`).join("");
      };

      const addFiles = (chosen) => {
        for (const file of chosen) {
          if (files.length >= MAX_FILES) {
            errorElement.textContent = `Up to ${MAX_FILES} per post.`;
            break;
          }
          if (file.type.startsWith("video") && file.size > MAX_VIDEO_MB * 1024 * 1024) {
            errorElement.textContent = /^wtv-/.test(file.name)
              ? `That video is still over ${MAX_VIDEO_MB}MB after shrinking. Trim it and try again.`
              : `${file.name} is over ${MAX_VIDEO_MB}MB. Trim it or export at a lower quality.`;
            continue;
          }
          files.push(file);
        }
        drawPreviews();
      };

      form.elements.media.addEventListener("change", () => {
        errorElement.textContent = "";
        addFiles([...form.elements.media.files]);
        form.elements.media.value = "";
      });

      // In the app, use the native picker: it skips iOS's slow conversion and
      // shrinks videos on the phone, so posting is much quicker.
      const pick = form.querySelector(".composer-pick");
      pick.addEventListener("click", async (event) => {
        if (!native.hasMediaPicker?.()) return;
        event.preventDefault();
        if (pick.classList.contains("is-busy")) return;
        errorElement.textContent = "";
        if (files.length >= MAX_FILES) return void (errorElement.textContent = `Up to ${MAX_FILES} per post.`);
        const title = pick.querySelector("strong");
        try {
          const chosen = await native.pickMedia(MAX_FILES - files.length, ({ done, total }) => {
            pick.classList.add("is-busy");
            title.textContent = total > 1 ? `Preparing ${Math.min(done + 1, total)} of ${total}...` : "Preparing...";
          });
          if (chosen) addFiles(chosen);
        } catch (error) {
          errorElement.textContent = "Couldn't open that. Try again.";
        } finally {
          pick.classList.remove("is-busy");
          title.textContent = "Add photos or videos";
        }
      });

      previews.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-file]");
        if (!remove) return;
        files.splice(Number(remove.dataset.removeFile), 1);
        drawPreviews();
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorElement.textContent = "";
        if (!files.length) return void (errorElement.textContent = "Add at least one photo or video.");
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        const label = button.firstElementChild;
        const uid = me().id;
        const uploaded = [];
        try {
          // Get everything ready first (video length and thumbnails, resized
          // photos), then upload with one overall percentage.
          label.textContent = "Preparing...";
          const jobs = [];
          for (const [index, file] of files.entries()) {
            const stamp = `${Date.now()}-${index}`;
            if (file.type.startsWith("video")) {
              const info = await videoInfo(file);
              const duration = file.__duration || info.duration;
              if (duration > MAX_VIDEO_SECONDS + 1) throw new Error(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds. Trim it and try again.`);
              const extension = file.type === "video/quicktime" ? "mov" : "mp4";
              jobs.push({ index, type: "video", path: `${uid}/${stamp}.${extension}`, blob: file, contentType: file.type || "video/mp4",
                poster: info.poster ? { path: `${uid}/${stamp}-poster.jpg`, blob: info.poster } : null });
            } else {
              const blob = await account().resizeImage(file, 1600);
              jobs.push({ index, type: "image", path: `${uid}/${stamp}.jpg`, blob, contentType: "image/jpeg" });
            }
          }
          const total = jobs.reduce((sum, job) => sum + job.blob.size + (job.poster?.blob.size || 0), 0) || 1;
          let sent = 0;
          const show = (extra = 0) => { label.textContent = `Uploading ${Math.min(99, Math.round(((sent + extra) / total) * 100))}%`; };
          show();
          for (const job of jobs) {
            const result = await uploadMedia(job.path, job.blob, job.contentType, show);
            if (result.error) throw result.error;
            uploaded.push(job.path);
            sent += job.blob.size;
            let poster = null;
            if (job.poster) {
              const thumb = await uploadMedia(job.poster.path, job.poster.blob, "image/jpeg", show);
              if (!thumb.error) { uploaded.push(job.poster.path); poster = job.poster.path; }
              sent += job.poster.blob.size;
            }
            files[job.index].__media = job.type === "video" ? { path: job.path, type: "video", poster } : { path: job.path, type: "image" };
          }
          label.textContent = "Posting...";
          const { error } = await client().from("posts").insert({
            creator_id: uid,
            caption: form.elements.caption.value.trim().slice(0, 2200) || null,
            media: files.map((file) => file.__media),
          });
          if (error) throw error;
          const creator = social.creators.get(uid);
          if (creator) creator.posts_count += 1;
          native.haptic("MEDIUM");
          app.showToast("Posted");
          files = [];
          sheet.stack.pop();
          drawSheet();
        } catch (error) {
          if (uploaded.length) client().storage.from("media").remove(uploaded);
          errorElement.textContent = account().friendlyError?.(error) || error.message;
        } finally {
          button.disabled = false;
          label.textContent = "Share post";
        }
      });
    }, { push: !sheet.overlay.hidden });
  }

  // ---------- friends (mutual follows between normal users) ----------

  const IGNORED_KEY = "wtv-ignored-requests";
  const SEEN_KEY = "wtv-activity-seen";
  const friends = {
    people: new Map(),
    incoming: new Set(),
    list: [],
    requests: [],
    sent: [],
    activity: [],
    ignored: new Set(),
  };

  function readLocal(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Browser storage blocked: fine for this session.
    }
  }

  function personAvatar(person, size = "avatar-md") {
    return avatarMarkup({ name: person?.name || person?.username || "?", avatar_path: person?.avatar_path }, size);
  }

  function relation(personId) {
    const iFollow = social.follows.has(personId);
    const theyFollow = friends.incoming.has(personId);
    if (iFollow && theyFollow) return "friends";
    if (iFollow) return "requested";
    if (theyFollow) return "wants";
    return "none";
  }

  function friendButton(person) {
    if (!person || (me() && person.id === me().id)) return "";
    const state = relation(person.id);
    if (state === "friends") return `<button type="button" class="follow-button is-following is-small" data-person="${esc(person.id)}">Friends</button>`;
    if (state === "requested") return `<button type="button" class="follow-button is-following is-small" data-friend-cancel="${esc(person.id)}">Requested</button>`;
    if (state === "wants") return `<button type="button" class="follow-button is-small" data-friend-add="${esc(person.id)}">Accept</button>`;
    return `<button type="button" class="follow-button is-small" data-friend-add="${esc(person.id)}">Add friend</button>`;
  }

  async function loadFriends() {
    const db = client();
    friends.people = new Map();
    friends.incoming = new Set();
    friends.list = [];
    friends.requests = [];
    friends.sent = [];
    friends.activity = [];
    friends.ignored = new Set(readLocal(IGNORED_KEY, []));
    if (!db || !me()) return;

    const { data: incoming } = await db.from("follows").select("follower_id").eq("creator_id", me().id);
    friends.incoming = new Set((incoming || []).map((row) => row.follower_id));
    const ids = [...new Set([...friends.incoming, ...social.follows])].filter((id) => !social.blocks.has(id));
    if (ids.length) {
      const { data: people } = await db.from("people").select("*").in("id", ids);
      friends.people = new Map((people || []).map((person) => [person.id, person]));
    }
    const isPerson = (id) => friends.people.has(id) && !friends.people.get(id).is_creator;
    friends.list = [...friends.people.values()].filter((person) => relation(person.id) === "friends");
    friends.requests = [...friends.incoming].filter((id) => !social.follows.has(id) && !friends.ignored.has(id) && isPerson(id)).map((id) => friends.people.get(id));
    friends.sent = [...social.follows].filter((id) => !friends.incoming.has(id) && isPerson(id)).map((id) => friends.people.get(id));

    if (friends.list.length) {
      const { data: saves } = await db.from("saved_events")
        .select("user_id, event_key, event, created_at")
        .in("user_id", friends.list.map((person) => person.id))
        .order("created_at", { ascending: false })
        .limit(60);
      const today = app.todayString();
      const live = new Map(app.state.events.map((event) => [app.eventKey(event), event]));
      friends.activity = (saves || [])
        .map((row) => ({ ...row, event: live.get(row.event_key) || row.event, person: friends.people.get(row.user_id) }))
        .filter((row) => row.event?.date >= today && row.person);
    }
    updateActivityDot();
  }

  function updateActivityDot() {
    const seen = readLocal(SEEN_KEY, 0);
    const newest = friends.activity[0] ? new Date(friends.activity[0].created_at).getTime() : 0;
    const unseen = friends.requests.length > 0 || newest > seen;
    document.querySelector('[data-tab="following"]')?.classList.toggle("has-dot", Boolean(me()) && unseen);
    // Friend requests also show on the menu button and on Following in the menu.
    account().updateMenuButton?.();
  }

  function markActivitySeen() {
    const newest = friends.activity[0] ? new Date(friends.activity[0].created_at).getTime() : 0;
    if (newest) writeLocal(SEEN_KEY, Math.max(newest, readLocal(SEEN_KEY, 0)));
    document.querySelector('[data-tab="following"]')?.classList.toggle("has-dot", friends.requests.length > 0);
    account().updateMenuButton?.();
  }

  function timeAgo(timestamp) {
    const minutes = Math.round((Date.now() - new Date(timestamp).getTime()) / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    const days = Math.round(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }

  function personRow(person, extra = "") {
    return `<div class="creator-card">
      <button type="button" class="creator-open" data-person="${esc(person.id)}">
        ${personAvatar(person)}
        <span><strong>${esc(person.name || person.username)}</strong><small>@${esc(person.username || "")}</small></span>
      </button>
      ${extra || friendButton(person)}
    </div>`;
  }

  function friendsSection() {
    const views = window.VibeViews;
    if (!me()) return "";
    const noUsername = !account().profile?.username;
    const eventCard = (row) => {
      const event = app.findEvent(row.event?.id) || row.event;
      return event?.id && app.findEvent(event.id) ? views.feedCard(event) : "";
    };
    return `
      <section class="friends-block">
        ${views.sectionHead("Friends", friends.list.length)}
        ${noUsername ? `<div class="following-intro is-compact">
          <p>Add a username so your friends can find you.</p>
          <button type="button" class="drawer-primary" data-edit-profile><span>Set my username</span><span>&rarr;</span></button>
        </div>` : ""}
        ${friends.requests.length ? `<h3 class="feed-day-title">Friend requests <span>${friends.requests.length}</span></h3>
          <div class="creator-list">${friends.requests.map((person) => personRow(person, `<span class="request-actions">
            <button type="button" class="follow-button is-small" data-friend-add="${esc(person.id)}">Accept</button>
            <button type="button" class="follow-button is-following is-small" data-friend-ignore="${esc(person.id)}">Ignore</button>
          </span>`)).join("")}</div>` : ""}
        ${friends.list.length ? `<div class="following-row">${friends.list.map((person) => `<button type="button" class="following-chip" data-person="${esc(person.id)}">${personAvatar(person)}<span>${esc(person.name || person.username)}</span></button>`).join("")}</div>` : ""}
        ${friends.list.length ? `<h3 class="feed-day-title">Friends' activity</h3>
          ${friends.activity.length ? `<div class="activity-list">${friends.activity.slice(0, 20).map((row) => `
            <div class="activity-item">
              <p class="activity-line"><button type="button" class="activity-who" data-person="${esc(row.user_id)}">${esc(row.person.name || row.person.username)}</button> saved an event <span>${esc(timeAgo(row.created_at))}</span></p>
              ${eventCard(row)}
            </div>`).join("")}</div>`
          : '<p class="drawer-fine">When your friends save events, they show here and you get a notification.</p>'}` : ""}
        ${friends.sent.length ? `<h3 class="feed-day-title">Requests you've sent <span>${friends.sent.length}</span></h3>
          <div class="creator-list">${friends.sent.map((person) => personRow(person)).join("")}</div>` : ""}
        <h3 class="feed-day-title">Add friends</h3>
        <label class="creator-search"><span class="sr-only">Find friends by username</span>
          <input type="search" id="friendSearch" placeholder="Search by name or username" autocomplete="off" autocapitalize="off" />
        </label>
        <div class="creator-list" id="friendResults"></div>
        <p class="drawer-fine">You become friends when you both add each other. Only friends see what you save.</p>
      </section>`;
  }

  let friendSearchTimer = null;
  async function searchPeople(query) {
    const target = document.querySelector("#friendResults");
    if (!target) return;
    const clean = query.replace(/[^a-z0-9._ ]/gi, "").trim();
    if (clean.length < 2) {
      target.innerHTML = "";
      return;
    }
    const { data } = await client().from("people").select("*")
      .or(`username.ilike.%${clean}%,name.ilike.%${clean}%`)
      .eq("is_creator", false)
      .limit(20);
    const results = (data || []).filter((person) => person.id !== me()?.id && !social.blocks.has(person.id));
    results.forEach((person) => friends.people.set(person.id, person));
    target.innerHTML = results.length ? results.map((person) => personRow(person)).join("") : '<p class="drawer-fine">No one found with that name.</p>';
  }

  async function addFriend(personId, button) {
    if (!requireSignIn("Sign in to add friends.")) return;
    if (button) button.disabled = true;
    const { error } = await client().from("follows").insert({ follower_id: me().id, creator_id: personId });
    if (button) button.disabled = false;
    if (error && !/duplicate/i.test(error.message)) {
      app.showToast("Couldn't add them. Try again.");
      return;
    }
    social.follows.add(personId);
    native.haptic("MEDIUM");
    // Let them know on their phone (the server checks it's a real, new request).
    account().api?.("/api/push", { method: "POST", body: JSON.stringify({ action: "friend", personId }) }).catch(() => undefined);
    const person = friends.people.get(personId);
    app.showToast(friends.incoming.has(personId) ? `You and ${person?.name || "them"} are now friends` : "Request sent. You'll be friends when they add you back.");
    await loadFriends();
    document.dispatchEvent(new CustomEvent("vibe:following-changed"));
  }

  async function removeFriend(personId, { confirmFirst = true } = {}) {
    const person = friends.people.get(personId);
    if (confirmFirst && !window.confirm(`Remove ${person?.name || "this friend"}? You'll stop seeing each other's saved events.`)) return;
    await client().from("follows").delete().eq("creator_id", personId).eq("follower_id", me().id);
    social.follows.delete(personId);
    await loadFriends();
    document.dispatchEvent(new CustomEvent("vibe:following-changed"));
  }

  function ignoreRequest(personId) {
    friends.ignored.add(personId);
    writeLocal(IGNORED_KEY, [...friends.ignored]);
    friends.requests = friends.requests.filter((person) => person.id !== personId);
    updateActivityDot();
    document.dispatchEvent(new CustomEvent("vibe:following-changed"));
  }

  function openPerson(personId) {
    const creator = social.creators.get(personId);
    if (creator) return openProfile(personId, { push: !sheet.overlay.hidden });
    openSheet("Friend", async (body) => {
      let person = friends.people.get(personId);
      if (!person) {
        const { data } = await client().from("people").select("*").eq("id", personId).maybeSingle();
        person = data;
      }
      if (!person) {
        body.innerHTML = '<p class="drawer-fine sheet-loading">This person is no longer on Where\'s The Vibe.</p>';
        return;
      }
      const state = relation(person.id);
      const saves = friends.activity.filter((row) => row.user_id === person.id);
      const views = window.VibeViews;
      body.innerHTML = `
        <header class="profile-head">
          ${personAvatar(person, "avatar-xl")}
          <div class="profile-name">
            <p class="profile-type">${state === "friends" ? "Friend" : "Going out"}</p>
            <h2>${esc(person.name || person.username)}</h2>
            <p class="profile-handle">@${esc(person.username)}</p>
          </div>
        </header>
        <div class="profile-actions">
          ${state === "friends" ? `<button type="button" class="drawer-secondary" data-friend-remove="${esc(person.id)}">Remove friend</button>`
            : state === "requested" ? `<button type="button" class="drawer-secondary" data-friend-cancel="${esc(person.id)}">Cancel request</button>`
            : `<button type="button" class="drawer-primary" data-friend-add="${esc(person.id)}"><span>${state === "wants" ? "Accept friend request" : "Add friend"}</span><span>+</span></button>`}
          <button type="button" class="drawer-secondary profile-more" data-person-more="${esc(person.id)}" aria-label="More options">&middot;&middot;&middot;</button>
        </div>
        <h3 class="feed-day-title">Saved events</h3>
        ${state !== "friends" ? '<p class="drawer-fine profile-empty">Become friends to see what they save.</p>'
          : saves.length ? views.groupedFeed(saves.map((row) => row.event).filter((event) => event?.id && app.findEvent(event.id)))
          : '<p class="drawer-fine profile-empty">Nothing saved right now, or they keep their saves private.</p>'}`;
      sheet.title.textContent = `@${person.username}`;
    }, { push: !sheet.overlay.hidden });
  }

  function personMore(personId) {
    const person = friends.people.get(personId);
    openSheet(person?.name || "Options", (body) => {
      body.innerHTML = `<div class="post-actions is-stacked">
        <button type="button" class="drawer-secondary" data-report-profile="${esc(personId)}">Report</button>
        <button type="button" class="drawer-danger" data-block="${esc(personId)}">Block ${esc(person?.name || "")}</button>
      </div>`;
    }, { push: true });
  }

  // ---------- events ----------

  document.addEventListener("click", (event) => {
    const friendTarget = event.target.closest("[data-friend-add], [data-friend-cancel], [data-friend-remove], [data-friend-ignore], [data-person], [data-person-more]");
    if (friendTarget) {
      const data = friendTarget.dataset;
      if (data.friendAdd) return addFriend(data.friendAdd, friendTarget).then(() => { if (!sheet.overlay.hidden) drawSheet(); });
      if (data.friendCancel) return removeFriend(data.friendCancel, { confirmFirst: false }).then(() => { if (!sheet.overlay.hidden) drawSheet(); });
      if (data.friendRemove) return removeFriend(data.friendRemove).then(() => { if (!sheet.overlay.hidden) drawSheet(); });
      if (data.friendIgnore) return ignoreRequest(data.friendIgnore);
      if (data.personMore) return personMore(data.personMore);
      if (data.person) return openPerson(data.person);
    }
    const target = event.target.closest("[data-follow], [data-profile], [data-post], [data-compose], [data-edit-profile], [data-more], [data-report-post], [data-report-profile], [data-block], [data-unblock], [data-delete-post], [data-profile-tab], [data-signin], [data-share-profile]");
    if (!target) return;
    const data = target.dataset;
    if (data.follow) return toggleFollow(data.follow, target);
    if (data.profile) return openProfile(data.profile, { push: !sheet.overlay.hidden });
    if (data.post) return openPost(data.post);
    if ("compose" in data) return openComposer();
    if ("editProfile" in data) {
      closeSheet();
      return account().showView?.("profile");
    }
    if (data.more) return profileMore(data.more);
    if (data.reportPost) return report({ postId: data.reportPost });
    if (data.reportProfile) return report({ profileId: data.reportProfile });
    if (data.block) return block(data.block);
    if (data.unblock) {
      return unblock(data.unblock).then(() => {
        if (!sheet.overlay.hidden) drawSheet();
      });
    }
    if (data.deletePost) return deletePost(data.deletePost, target);
    if ("signin" in data) return account().showView?.("signin");
    if (data.shareProfile) {
      const creator = social.creators.get(data.shareProfile);
      return native.share({ title: creator?.name, text: `${creator?.name} on Where's The Vibe`, url: `${native.siteUrl}/?profile=${encodeURIComponent(creator?.username || "")}` });
    }
    if (data.profileTab) {
      const panel = target.closest(".sheet-body");
      panel.querySelectorAll("[data-profile-tab]").forEach((tab) => {
        const active = tab === target;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      panel.querySelectorAll("[data-profile-panel]").forEach((section) => { section.hidden = section.dataset.profilePanel !== data.profileTab; });
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "friendSearch") {
      clearTimeout(friendSearchTimer);
      friendSearchTimer = setTimeout(() => searchPeople(event.target.value), 250);
      return;
    }
    if (event.target.id !== "creatorSearch") return;
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("#creatorList .creator-card").forEach((card) => {
      card.hidden = Boolean(query) && !card.textContent.toLowerCase().includes(query);
    });
  });

  sheet.close.addEventListener("click", closeSheet);
  sheet.back.addEventListener("click", sheetBack);
  sheet.overlay.addEventListener("click", (event) => { if (event.target === sheet.overlay) closeSheet(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !sheet.overlay.hidden) sheetBack(); });

  // Open a feed event from a profile: close the sheet first so the details sit on top.
  sheet.body.addEventListener("click", (event) => {
    const open = event.target.closest(".feed-open");
    if (open) {
      closeSheet();
      app.openEventDetail(open.dataset.eventId);
      return;
    }
    const save = event.target.closest(".feed-save");
    if (save) {
      app.toggleSaved(save.dataset.saveId).then(() => {
        const event = app.findEvent(save.dataset.saveId);
        const saved = event && app.isSaved(event);
        save.classList.toggle("is-saved", Boolean(saved));
        save.setAttribute("aria-pressed", String(Boolean(saved)));
      });
    }
  });

  document.addEventListener("vibe:accounts-ready", load);
  document.addEventListener("vibe:auth", load);

  const linkedProfile = new URLSearchParams(location.search).get("profile");
  if (linkedProfile) document.addEventListener("vibe:accounts-ready", () => openProfile(linkedProfile), { once: true });

  // A friend request or friend's save arrived while the app is open.
  native.onPushReceived?.((data) => {
    if (/^friend-/.test(data?.kind || "") && me()) loadFriends().then(() => document.dispatchEvent(new CustomEvent("vibe:following-changed")));
  });

  // Friends' saves change while the app is open: refresh when it comes back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && me()) loadFriends().then(() => document.dispatchEvent(new CustomEvent("vibe:following-changed")));
  });

  window.VibeSocial = { openProfile, openPerson, openBlocked, openComposer, renderFollowing, load, state: social, friends };
})();
