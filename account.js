// Side menu: profile, preferences, settings, event submissions and approvals.
// Sign-in uses Supabase (email code everywhere, Sign in with Apple in the
// iPhone app). If Supabase isn't set up yet, the menu still works and the
// account parts say so.
(function () {
  const app = window.VibeApp;
  if (!app) return;
  const { native } = app;

  const PREFS_KEY = "wtv-preferences";
  const DEFAULT_PREFS = {
    favouriteTypes: [],
    favouriteAreas: [],
    openWithFavourites: false,
    reminderDayBefore: true,
    reminderOnDay: true,
  };
  const AGE_OPTIONS = ["All Ages", "16+", "18+", "21+", "23+", "25+", "30+"];
  const SUBMIT_TYPES = ["Night Party", "Day Party", "Brunch", "Concert", "Festival", "Games Night", "LGBTQ+", "Other"];

  const ui = {
    button: document.querySelector("#menuButton"),
    drawer: document.querySelector("#drawer"),
    overlay: document.querySelector("#drawerOverlay"),
    content: document.querySelector("#drawerContent"),
    title: document.querySelector("#drawerTitle"),
    back: document.querySelector("#drawerBack"),
    close: document.querySelector("#drawerClose"),
  };

  const account = {
    configured: false,
    configError: "",
    client: null,
    session: null,
    profile: null,
    isAdmin: false,
    pendingCount: 0,
    prefs: { ...DEFAULT_PREFS },
    otpEmail: "",
    afterSignIn: null,
  };

  const viewStack = [];

  // ---------- helpers ----------

  function esc(value = "") {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cleanUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function cleanHandle(value) {
    const handle = String(value || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "");
    return handle ? `@${handle.slice(0, 30)}` : "";
  }

  function signedIn() {
    return Boolean(account.session?.user);
  }

  function userEmail() {
    return account.session?.user?.email || "";
  }

  function displayName() {
    return account.profile?.display_name || userEmail().split("@")[0] || "You";
  }

  function todayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  async function authHeaders() {
    const { data } = await account.client.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function api(path, options = {}) {
    const response = await fetch(`${native.apiBase}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(options.headers || {}) },
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) throw Object.assign(new Error(body.error || "Something went wrong"), { status: response.status });
    return body;
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "");
    if (/token has expired|invalid/i.test(message) && /otp|token/i.test(message)) return "That code didn't work. Check it, or send a new one.";
    if (/rate limit|security purposes/i.test(message)) return "Too many tries. Wait a minute, then try again.";
    if (/failed to fetch|network/i.test(message)) return "You look offline. Check your connection and try again.";
    if (/canceled|cancelled|1001/i.test(message)) return "";
    return message || "Something went wrong. Try again.";
  }

  // ---------- preferences ----------

  async function loadLocalPrefs() {
    const stored = await native.storage.get(PREFS_KEY);
    account.prefs = { ...DEFAULT_PREFS, ...(stored || {}) };
  }

  function prefsFromProfile(profile) {
    return {
      favouriteTypes: profile.favourite_types || [],
      favouriteAreas: profile.favourite_areas || [],
      openWithFavourites: Boolean(profile.open_with_favourites),
      reminderDayBefore: profile.reminder_day_before !== false,
      reminderOnDay: profile.reminder_on_day !== false,
    };
  }

  async function savePrefs(changes) {
    account.prefs = { ...account.prefs, ...changes };
    await native.storage.set(PREFS_KEY, account.prefs);
    if (signedIn()) {
      await updateProfile({
        favourite_types: account.prefs.favouriteTypes,
        favourite_areas: account.prefs.favouriteAreas,
        open_with_favourites: account.prefs.openWithFavourites,
        reminder_day_before: account.prefs.reminderDayBefore,
        reminder_on_day: account.prefs.reminderOnDay,
      }, { quiet: true });
    }
  }

  app.hooks.reminderOptions = () => ({ dayBefore: account.prefs.reminderDayBefore, onDay: account.prefs.reminderOnDay });

  function hasFavourites() {
    return account.prefs.favouriteTypes.length > 0 || account.prefs.favouriteAreas.length > 0;
  }

  function applyFavouritesOnOpen() {
    if (account.prefs.openWithFavourites && hasFavourites() && app.state.events.length) {
      app.applyFavourites(account.prefs.favouriteTypes, account.prefs.favouriteAreas);
    }
  }

  // ---------- Supabase ----------

  function sessionStorageAdapter() {
    return {
      getItem: async (key) => (await native.storage.get(`sb-${key}`)) ?? null,
      setItem: async (key, value) => native.storage.set(`sb-${key}`, value),
      removeItem: async (key) => native.storage.set(`sb-${key}`, null),
    };
  }

  async function initSupabase() {
    if (!window.supabase?.createClient) {
      account.configError = "Sign-in could not load.";
      return;
    }
    try {
      const response = await fetch(`${native.apiBase}/api/config`, { headers: { Accept: "application/json" } });
      const config = await response.json();
      if (!config.accounts) return;
      account.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { storage: sessionStorageAdapter(), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: { fetch: native.webFetch },
      });
      account.configured = true;
      const { data } = await account.client.auth.getSession();
      account.session = data?.session || null;
      account.client.auth.onAuthStateChange((event, session) => {
        const wasSignedIn = signedIn();
        account.session = session;
        // Supabase advises not running its own calls inside this callback.
        if (event === "SIGNED_IN" && !wasSignedIn) setTimeout(() => onSignedIn(), 0);
        if (event === "SIGNED_OUT") setTimeout(onSignedOut, 0);
      });
      if (signedIn()) await onSignedIn({ silent: true });
    } catch {
      account.configError = "Sign-in is offline right now.";
    }
  }

  async function loadProfile() {
    const { data, error } = await account.client.from("profiles").select("*").eq("id", account.session.user.id).maybeSingle();
    if (error) throw error;
    if (data) return data;
    const created = { id: account.session.user.id, display_name: account.session.user.user_metadata?.full_name || null };
    const insert = await account.client.from("profiles").insert(created).select("*").single();
    if (insert.error) throw insert.error;
    return insert.data;
  }

  async function updateProfile(changes, { quiet = false } = {}) {
    if (!signedIn()) return false;
    const { data, error } = await account.client
      .from("profiles")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", account.session.user.id)
      .select("*")
      .single();
    if (error) {
      if (!quiet) app.showToast("Couldn't save that. Try again.");
      return false;
    }
    account.profile = data;
    return true;
  }

  async function syncSavedEvents() {
    const { data, error } = await account.client.from("saved_events").select("event_key, event");
    if (error) return;
    const today = todayString();
    const server = new Map((data || []).map((row) => [row.event_key, row.event]));
    const missingOnServer = [...app.state.saved.entries()].filter(([key]) => !server.has(key));
    if (missingOnServer.length) {
      await account.client.from("saved_events").upsert(
        missingOnServer.map(([key, event]) => ({ user_id: account.session.user.id, event_key: key, event })),
      );
    }
    const merged = new Map([...server.entries(), ...app.state.saved.entries()]);
    for (const [key, event] of merged) if (event?.date && event.date < today) merged.delete(key);
    app.state.saved = merged;
    await app.persistSaved();
    for (const [key, event] of merged) native.scheduleReminders(event, key, app.hooks.reminderOptions());
    app.render(true);
  }

  app.hooks.savedChanged = (key, event) => {
    if (!signedIn()) return;
    const table = account.client.from("saved_events");
    const request = event
      ? table.upsert({ user_id: account.session.user.id, event_key: key, event })
      : table.delete().eq("event_key", key);
    request.then(({ error }) => { if (error) console.warn("Saved event sync failed", error.message); });
  };

  async function checkAdmin() {
    try {
      const result = await api("/api/admin");
      account.isAdmin = Boolean(result.admin);
      account.pendingCount = (result.submissions || []).length + (result.creators || []).length + (result.reports || []).length;
    } catch {
      account.isAdmin = false;
      account.pendingCount = 0;
    }
  }

  async function onSignedIn({ silent = false } = {}) {
    try {
      account.profile = await loadProfile();
      const profilePrefs = prefsFromProfile(account.profile);
      const profileHasPrefs = account.profile.updated_at && account.profile.updated_at !== account.profile.created_at;
      if (profileHasPrefs) {
        account.prefs = profilePrefs;
        await native.storage.set(PREFS_KEY, account.prefs);
      } else {
        await savePrefs({});
      }
    } catch (error) {
      console.warn("Profile load failed", error?.message);
    }
    await Promise.all([syncSavedEvents(), checkAdmin()]);
    updateMenuButton();
    document.dispatchEvent(new CustomEvent("vibe:auth"));
    if (!silent) {
      app.showToast(`Signed in as ${displayName()}`);
      const next = account.afterSignIn;
      account.afterSignIn = null;
      if (isOpen()) {
        viewStack.length = 0;
        showView("menu", { replace: true });
        if (next) showView(next);
      }
    }
  }

  function onSignedOut() {
    account.profile = null;
    account.isAdmin = false;
    account.pendingCount = 0;
    updateMenuButton();
    document.dispatchEvent(new CustomEvent("vibe:auth"));
    if (isOpen()) {
      viewStack.length = 0;
      showView("menu", { replace: true });
    }
  }

  // ---------- drawer ----------

  function isOpen() {
    return ui.drawer.classList.contains("open");
  }

  function openDrawer(view = "menu") {
    native.haptic();
    viewStack.length = 0;
    showView(view, { replace: true });
    ui.overlay.hidden = false;
    ui.drawer.setAttribute("aria-hidden", "false");
    ui.button.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-open");
    requestAnimationFrame(() => {
      ui.overlay.classList.add("show");
      ui.drawer.classList.add("open");
    });
    ui.close.focus();
  }

  function closeDrawer() {
    ui.overlay.classList.remove("show");
    ui.drawer.classList.remove("open");
    ui.drawer.setAttribute("aria-hidden", "true");
    ui.button.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
    setTimeout(() => { ui.overlay.hidden = true; }, 250);
    ui.button.focus();
  }

  function updateMenuButton() {
    ui.button.classList.toggle("has-badge", account.isAdmin && account.pendingCount > 0);
  }

  const VIEWS = {
    menu: { title: "Menu", render: renderMenu },
    signin: { title: "Sign in", render: renderSignIn },
    profile: { title: "Profile", render: renderProfile, needsAccount: true },
    preferences: { title: "Preferences", render: renderPreferences },
    settings: { title: "Settings", render: renderSettings },
    submit: { title: "Submit an event", render: renderSubmit, needsAccount: true },
    admin: { title: "Approvals", render: renderAdmin, needsAccount: true },
  };

  function showView(name, { replace = false } = {}) {
    let view = VIEWS[name] || VIEWS.menu;
    if (view.needsAccount && !signedIn()) {
      account.afterSignIn = name;
      name = "signin";
      view = VIEWS.signin;
    }
    if (replace) viewStack.length = 0;
    viewStack.push(name);
    ui.title.textContent = view.title;
    ui.back.hidden = viewStack.length < 2;
    ui.content.scrollTop = 0;
    view.render();
  }

  function goBack() {
    if (viewStack.length < 2) return;
    viewStack.pop();
    const name = viewStack.pop();
    showView(name);
  }

  function icon(name) {
    const paths = {
      profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
      preferences: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
      submit: '<path d="M12 5v14M5 12h14"/>',
      admin: '<path d="m5 12 4 4 10-10"/>',
      saved: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z"/>',
      mail: '<rect x="3" y="5" width="18" height="14"/><path d="m3 6 9 7 9-7"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
  }

  function menuItem(view, label, detail = "", badge = "") {
    return `<button type="button" class="drawer-item" data-view="${view}">
      ${icon(view)}<span><strong>${esc(label)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</span>
      ${badge ? `<em>${esc(badge)}</em>` : ""}<b aria-hidden="true">&rsaquo;</b>
    </button>`;
  }

  function renderMenu() {
    const savedTotal = app.savedEvents().length;
    const head = signedIn()
      ? `<button type="button" class="drawer-account" data-view="profile">
          <span class="avatar">${esc(displayName().slice(0, 1).toUpperCase())}</span>
          <span><strong>${esc(displayName())}</strong><small>${esc(account.profile?.account_type === "brand" ? `Event brand${account.profile.brand_name ? ` / ${account.profile.brand_name}` : ""}` : userEmail())}</small></span>
        </button>`
      : `<div class="drawer-signin-card">
          <p>Sign in to keep your saved events on every device, set your preferences, and submit events if you run a brand.</p>
          <button type="button" class="drawer-primary" data-view="signin"><span>Sign in or create account</span><span>&rarr;</span></button>
        </div>`;

    ui.content.innerHTML = `${head}
      <nav class="drawer-list">
        ${menuItem("profile", "Profile", signedIn() ? "Name, Brand or DJ profile, Instagram" : "Sign in to set up")}
        ${menuItem("preferences", "Preferences", "Favourite events, areas, reminders")}
        ${menuItem("settings", "Settings", "Account, notifications, privacy")}
        ${menuItem("submit", "Submit an event", "For event brands and promoters")}
        ${account.isAdmin ? menuItem("admin", "Approvals", "Events, Brand and DJ profiles, reports", account.pendingCount ? String(account.pendingCount) : "") : ""}
      </nav>
      <nav class="drawer-list drawer-list-minor">
        <button type="button" class="drawer-item" data-action="saved">${icon("saved")}<span><strong>Saved events</strong></span><em>${savedTotal}</em><b aria-hidden="true">&rsaquo;</b></button>
        <button type="button" class="drawer-item" data-action="following">${icon("profile")}<span><strong>Following</strong></span><b aria-hidden="true">&rsaquo;</b></button>
        ${isApprovedCreator() ? `<button type="button" class="drawer-item" data-action="my-public-profile">${icon("submit")}<span><strong>My public profile</strong><small>Posts, followers, new post</small></span><b aria-hidden="true">&rsaquo;</b></button>` : ""}
      </nav>`;
  }

  // ---------- sign in ----------

  function accountsUnavailable() {
    return `<div class="drawer-note">
      <p>${esc(account.configError || "Accounts are being switched on. Check back soon.")}</p>
      <p>Saved events and preferences still work on this device in the meantime.</p>
    </div>`;
  }

  function renderSignIn() {
    if (!account.configured) {
      ui.content.innerHTML = accountsUnavailable();
      return;
    }
    const waitingForCode = Boolean(account.otpEmail);
    ui.content.innerHTML = `
      <div class="drawer-section">
        <p class="drawer-lead">${waitingForCode
          ? `We sent a sign-in code to <strong>${esc(account.otpEmail)}</strong>. It can take a minute to arrive.`
          : "No password needed. Enter your email and we'll send you a code."}</p>
        ${waitingForCode ? `
          <form class="drawer-form" id="otpForm" novalidate>
            <label class="field"><span>Code</span>
              <input id="otpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]*" placeholder="Enter the code" required />
            </label>
            <button class="drawer-primary" type="submit"><span>Sign in</span><span>&rarr;</span></button>
            <p class="form-error" role="alert"></p>
          </form>
          <div class="drawer-row">
            <button type="button" class="text-button" id="otpResend">Send a new code</button>
            <button type="button" class="text-button" id="otpChange">Use a different email</button>
          </div>`
        : `
          <form class="drawer-form" id="emailForm" novalidate>
            <label class="field"><span>Email</span>
              <input id="signinEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required />
            </label>
            <button class="drawer-primary" type="submit"><span>Send my code</span><span>&rarr;</span></button>
            <p class="form-error" role="alert"></p>
          </form>
          ${native.canUseApple ? `<div class="drawer-or"><span>or</span></div>
            <button type="button" class="apple-button" id="appleSignIn">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.5.9-1.4 1.3-2.8 1.3-2.9 0 0-2.6-1-2.6-4ZM13.9 4.9c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z"/></svg>
              <span>Sign in with Apple</span>
            </button>` : ""}`}
        <p class="drawer-fine">By signing in you agree to our <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a>.</p>
      </div>`;
  }

  async function sendCode(email, errorElement, button) {
    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
      errorElement.textContent = "Enter a valid email address.";
      return;
    }
    button && (button.disabled = true);
    errorElement.textContent = "";
    const { error } = await account.client.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    button && (button.disabled = false);
    if (error) {
      errorElement.textContent = friendlyError(error);
      return;
    }
    account.otpEmail = clean;
    renderSignIn();
    ui.content.querySelector("#otpCode")?.focus();
  }

  async function verifyCode(code, errorElement, button) {
    const token = String(code || "").replace(/\D/g, "");
    // Supabase sends 6 to 10 digits depending on the project's OTP length setting.
    if (token.length < 6 || token.length > 10) {
      errorElement.textContent = "Enter the full code from the email.";
      return;
    }
    button.disabled = true;
    errorElement.textContent = "";
    const { error } = await account.client.auth.verifyOtp({ email: account.otpEmail, token, type: "email" });
    button.disabled = false;
    if (error) {
      errorElement.textContent = friendlyError(error);
      return;
    }
    account.otpEmail = "";
  }

  async function signInWithApple(button) {
    button.disabled = true;
    try {
      const result = await native.appleSignIn();
      const { error } = await account.client.auth.signInWithIdToken({ provider: "apple", token: result.identityToken, nonce: result.nonce });
      if (error) throw error;
      if (result.name) {
        setTimeout(() => {
          if (account.profile && !account.profile.display_name) updateProfile({ display_name: result.name }, { quiet: true });
        }, 1500);
      }
    } catch (error) {
      const message = friendlyError(error);
      if (message) app.showToast(message);
    } finally {
      button.disabled = false;
    }
  }

  // ---------- profile ----------

  function isApprovedCreator() {
    return ["brand", "dj"].includes(account.profile?.account_type) && account.profile?.creator_status === "approved";
  }

  function mediaUrl(path) {
    return path && account.client ? account.client.storage.from("media").getPublicUrl(path).data.publicUrl : "";
  }

  const STATUS_TEXT = {
    pending: "Waiting for approval. We'll review your profile shortly. Until then it isn't public.",
    approved: "Approved. Your profile is public: people can follow you and you can post photos and videos.",
    rejected: "Not approved this time. Update your details and save to send it again.",
  };

  function renderProfile() {
    const profile = account.profile || {};
    const type = profile.account_type || "fan";
    const isCreator = type === "brand" || type === "dj";
    const status = isCreator ? profile.creator_status : "";
    const avatar = mediaUrl(profile.avatar_path);
    ui.content.innerHTML = `
      ${status && STATUS_TEXT[status] ? `<div class="status-banner status-${esc(status)}">${esc(STATUS_TEXT[status])}</div>` : ""}
      <form class="drawer-form drawer-section" id="profileForm" novalidate>
        <fieldset class="field segmented segmented-3">
          <legend>Account type</legend>
          <label><input type="radio" name="account_type" value="fan" ${isCreator ? "" : "checked"} /><span>Going out</span></label>
          <label><input type="radio" name="account_type" value="brand" ${type === "brand" ? "checked" : ""} /><span>Brand</span></label>
          <label><input type="radio" name="account_type" value="dj" ${type === "dj" ? "checked" : ""} /><span>DJ</span></label>
        </fieldset>
        <p class="drawer-fine creator-note" ${isCreator ? "hidden" : ""}>Run events or DJ? Pick Brand or DJ to get a public profile people can follow, with posts and your events.</p>
        <label class="field"><span>Your name</span>
          <input name="display_name" maxlength="60" autocomplete="name" value="${esc(profile.display_name || "")}" placeholder="What should we call you?" />
        </label>
        <div class="creator-fields" ${isCreator ? "" : "hidden"}>
          <div class="avatar-field">
            <span class="avatar avatar-lg">${avatar ? `<img src="${esc(avatar)}" alt="" />` : esc(displayName().slice(0, 1).toUpperCase())}</span>
            <label class="drawer-secondary avatar-pick">Change photo<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden /></label>
          </div>
          <label class="field"><span>Profile name *</span>
            <input name="brand_name" maxlength="80" value="${esc(profile.brand_name || "")}" placeholder="e.g. The Couples Den or DJ Name" />
          </label>
          <label class="field"><span>Username *</span>
            <input name="username" maxlength="30" autocapitalize="off" autocomplete="off" value="${esc(profile.username || "")}" placeholder="letters, numbers, . and _" />
          </label>
          <label class="field"><span>Bio</span>
            <textarea name="bio" rows="3" maxlength="300" placeholder="What you do, your sound, where to find you">${esc(profile.bio || "")}</textarea>
          </label>
        </div>
        <label class="field"><span>Instagram ${isCreator ? "*" : ""}</span>
          <input name="instagram" maxlength="100" autocapitalize="off" value="${esc(profile.instagram || "")}" placeholder="@yourhandle" />
        </label>
        <p class="drawer-fine creator-fields" ${isCreator ? "" : "hidden"}>Your Instagram links your profile to your events on the map, so your followers see them in Following.</p>
        <label class="check-row creator-fields" ${isCreator ? "" : "hidden"}>
          <input type="checkbox" name="terms" ${profile.terms_accepted_at ? "checked" : ""} />
          <span>I agree to the <a href="terms.html" target="_blank" rel="noopener">terms and community rules</a>. No offensive, abusive or illegal content.</span>
        </label>
        <label class="field"><span>Email</span>
          <input value="${esc(userEmail())}" disabled />
        </label>
        <button class="drawer-primary" type="submit"><span>Save profile</span><span>&rarr;</span></button>
        <p class="form-error" role="alert"></p>
      </form>
      ${isApprovedCreator() ? `<button type="button" class="drawer-item drawer-item-solo" data-action="my-public-profile">${icon("profile")}<span><strong>View my public profile</strong><small>Posts, followers, new post</small></span><b aria-hidden="true">&rsaquo;</b></button>` : ""}
      ${isCreator ? `<button type="button" class="drawer-item drawer-item-solo" data-view="submit">${icon("submit")}<span><strong>Submit an event</strong><small>Send us your next event</small></span><b aria-hidden="true">&rsaquo;</b></button>` : ""}`;
  }

  async function saveProfile(form) {
    const errorElement = form.querySelector(".form-error");
    const button = form.querySelector('button[type="submit"]');
    const type = form.querySelector('[name="account_type"]:checked')?.value || "fan";
    const isCreator = type !== "fan";
    const username = form.elements.username.value.trim().toLowerCase().replace(/^@/, "");
    const instagram = cleanHandle(form.elements.instagram.value);
    errorElement.textContent = "";
    if (isCreator) {
      if (!form.elements.brand_name.value.trim()) return void (errorElement.textContent = "Add your profile name.");
      if (!/^[a-z0-9._]{3,30}$/.test(username)) return void (errorElement.textContent = "Usernames are 3 to 30 letters, numbers, dots or underscores.");
      if (!instagram) return void (errorElement.textContent = "Add your Instagram so we can verify you and link your events.");
      if (!form.elements.terms.checked) return void (errorElement.textContent = "Agree to the terms to get a public profile.");
    }
    button.disabled = true;
    try {
      const changes = {
        display_name: form.elements.display_name.value.trim().slice(0, 60) || null,
        account_type: type,
        brand_name: isCreator ? form.elements.brand_name.value.trim().slice(0, 80) : account.profile?.brand_name || null,
        username: isCreator ? username : account.profile?.username || null,
        bio: isCreator ? form.elements.bio.value.trim().slice(0, 300) || null : account.profile?.bio || null,
        instagram: instagram || null,
        terms_accepted_at: isCreator ? account.profile?.terms_accepted_at || new Date().toISOString() : account.profile?.terms_accepted_at || null,
      };
      const avatarFile = form.elements.avatar?.files?.[0];
      if (avatarFile) {
        const blob = await resizeImage(avatarFile, 600);
        const path = `${account.session.user.id}/avatar-${Date.now()}.jpg`;
        const upload = await account.client.storage.from("media").upload(path, blob, { contentType: "image/jpeg" });
        if (upload.error) throw upload.error;
        changes.avatar_path = path;
      }
      const { data, error } = await account.client
        .from("profiles")
        .update({ ...changes, updated_at: new Date().toISOString() })
        .eq("id", account.session.user.id)
        .select("*")
        .single();
      if (error) {
        if (/profiles_username_key|duplicate/i.test(error.message)) throw new Error("That username is taken. Try another.");
        throw error;
      }
      const wasType = account.profile?.account_type;
      account.profile = data;
      app.showToast(isCreator && data.creator_status === "pending" && wasType !== type ? "Saved. Your profile is waiting for approval." : "Profile saved");
      renderProfile();
      document.dispatchEvent(new CustomEvent("vibe:auth"));
    } catch (error) {
      errorElement.textContent = friendlyError(error);
    } finally {
      button.disabled = false;
    }
  }

  // ---------- preferences ----------

  function chips(name, options, selected) {
    if (!options.length) return '<p class="drawer-fine">Options appear once events have loaded.</p>';
    return `<div class="chip-group">${options.map((option) => `
      <label class="chip"><input type="checkbox" name="${name}" value="${esc(option)}" ${selected.includes(option) ? "checked" : ""} /><span>${esc(option)}</span></label>`).join("")}</div>`;
  }

  function toggle(name, label, detail, checked) {
    return `<label class="switch-row">
      <span><strong>${esc(label)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</span>
      <input type="checkbox" name="${name}" ${checked ? "checked" : ""} /><i aria-hidden="true"></i>
    </label>`;
  }

  function renderPreferences() {
    const prefs = account.prefs;
    const types = ["Vibe Approved", ...app.eventTypes()];
    ui.content.innerHTML = `
      <form class="drawer-section" id="prefsForm">
        <h3 class="drawer-heading">Favourite events</h3>
        ${chips("favouriteTypes", types, prefs.favouriteTypes)}
        <h3 class="drawer-heading">Favourite areas</h3>
        ${chips("favouriteAreas", app.regions(), prefs.favouriteAreas)}
        ${toggle("openWithFavourites", "Open with my favourites", "Filter the map to these every time you open it", prefs.openWithFavourites)}
        <button type="button" class="drawer-secondary" id="showFavourites" ${hasFavourites() ? "" : "disabled"}>Show my favourites on the map</button>
        <h3 class="drawer-heading">Reminders for saved events</h3>
        ${toggle("reminderDayBefore", "The day before", "6pm the evening before", prefs.reminderDayBefore)}
        ${toggle("reminderOnDay", "On the day", "Midday on the day of the event", prefs.reminderOnDay)}
        ${native.isNative ? "" : '<p class="drawer-fine">Reminders arrive as notifications in the iPhone app.</p>'}
        <p class="drawer-fine">${signedIn() ? "Saved to your account." : "Saved on this device. Sign in to keep them everywhere."}</p>
      </form>`;
  }

  async function onPrefsChange(form) {
    const values = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
    const changes = {
      favouriteTypes: values("favouriteTypes"),
      favouriteAreas: values("favouriteAreas"),
      openWithFavourites: form.querySelector('[name="openWithFavourites"]').checked,
      reminderDayBefore: form.querySelector('[name="reminderDayBefore"]').checked,
      reminderOnDay: form.querySelector('[name="reminderOnDay"]').checked,
    };
    const remindersChanged = changes.reminderDayBefore !== account.prefs.reminderDayBefore || changes.reminderOnDay !== account.prefs.reminderOnDay;
    await savePrefs(changes);
    form.querySelector("#showFavourites").disabled = !hasFavourites();
    if (remindersChanged) {
      for (const [key, event] of app.state.saved) {
        await native.cancelReminders(key);
        native.scheduleReminders(event, key, app.hooks.reminderOptions());
      }
    }
  }

  // ---------- settings ----------

  function renderSettings() {
    ui.content.innerHTML = `
      <div class="drawer-section">
        <h3 class="drawer-heading">Account</h3>
        ${signedIn()
          ? `<p class="drawer-kv"><span>Signed in as</span><strong>${esc(userEmail() || "Apple ID")}</strong></p>
             <button type="button" class="drawer-secondary" id="signOut">Sign out</button>`
          : `<button type="button" class="drawer-secondary" data-view="signin">Sign in or create account</button>`}

        <h3 class="drawer-heading">Notifications</h3>
        <p class="drawer-fine">${native.isNative
          ? "Choose which reminders you get in Preferences. To switch notifications off completely, use your iPhone's Settings, then Notifications, then Where's The Vibe."
          : "Reminders are sent by the iPhone app."}</p>
        <button type="button" class="drawer-secondary" data-view="preferences">Reminder preferences</button>

        <h3 class="drawer-heading">About</h3>
        <a class="drawer-link" href="privacy.html" target="_blank" rel="noopener">Privacy policy <span>&nearr;</span></a>
        <a class="drawer-link" href="terms.html" target="_blank" rel="noopener">Terms and community rules <span>&nearr;</span></a>
        ${signedIn() ? '<button type="button" class="drawer-secondary" data-action="blocked">Blocked accounts</button>' : ""}
        <a class="drawer-link" href="mailto:vibeconnoisseur@outlook.com">Contact us <span>&nearr;</span></a>
        <a class="drawer-link" href="https://www.instagram.com/thevibeconnoisseurr/" target="_blank" rel="noopener">Instagram <span>&nearr;</span></a>

        ${signedIn() ? `
          <h3 class="drawer-heading danger">Delete account</h3>
          <p class="drawer-fine">This permanently deletes your profile, saved events and submissions. It can't be undone.</p>
          <button type="button" class="drawer-danger" id="deleteAccount">Delete my account</button>` : ""}
        <p class="drawer-version">Where's The Vibe / The Vibe Connoisseur</p>
      </div>`;
  }

  async function deleteAccount(button) {
    const sure = window.confirm("Delete your account? Your profile, saved events and submissions will be permanently removed.");
    if (!sure) return;
    button.disabled = true;
    try {
      await api("/api/account", { method: "DELETE" });
      await account.client.auth.signOut({ scope: "local" });
      app.showToast("Your account has been deleted.");
    } catch (error) {
      app.showToast(friendlyError(error));
      button.disabled = false;
    }
  }

  // ---------- submit an event ----------

  async function renderSubmit() {
    const profile = account.profile || {};
    const types = [...new Set([...SUBMIT_TYPES.slice(0, -1), ...app.eventTypes(), "Other"])];
    ui.content.innerHTML = `
      <form class="drawer-form drawer-section" id="submitForm" novalidate>
        <p class="drawer-lead">Send us your event. Once it's approved it goes on the map with its flyer.</p>
        <label class="field"><span>Event name *</span><input name="title" maxlength="140" required /></label>
        <div class="field-pair">
          <label class="field"><span>Type *</span>
            <select name="event_type" required>${types.map((type) => `<option>${esc(type)}</option>`).join("")}</select>
          </label>
          <label class="field"><span>Date *</span><input name="event_date" type="date" min="${todayString()}" required /></label>
        </div>
        <label class="field"><span>Venue and postcode *</span><input name="location" maxlength="200" placeholder="e.g. Brixton Jamm, SW9 6LH" required /></label>
        <div class="field-pair">
          <label class="field"><span>Age</span>
            <select name="age_range">${AGE_OPTIONS.map((age) => `<option ${age === "18+" ? "selected" : ""}>${age}</option>`).join("")}</select>
          </label>
          <label class="field"><span>Tickets from</span><input name="price" maxlength="40" placeholder="£15.00" /></label>
        </div>
        <label class="field"><span>Ticket link</span><input name="ticket_url" type="url" inputmode="url" autocapitalize="off" placeholder="https://" /></label>
        <label class="field"><span>Description</span>
          <textarea name="description" rows="4" maxlength="600" placeholder="What should people know? Music, dress code, who's playing."></textarea>
        </label>
        <label class="field"><span>Music or tags</span><input name="tags" maxlength="200" placeholder="Afrobeats, Amapiano, R&B" /></label>
        <label class="field"><span>Instagram</span><input name="instagram" maxlength="100" autocapitalize="off" value="${esc(profile.instagram || "")}" placeholder="@yourbrand" /></label>
        <label class="field file-field"><span>Flyer</span>
          <input name="flyer" type="file" accept="image/jpeg,image/png,image/webp" />
          <span class="file-preview" hidden><img alt="Flyer preview" /></span>
        </label>
        <button class="drawer-primary" type="submit"><span>Submit for approval</span><span>&rarr;</span></button>
        <p class="form-error" role="alert"></p>
        <p class="drawer-fine">* Required. We check every event before it goes live, usually within a day.</p>
      </form>
      <div class="drawer-section">
        <h3 class="drawer-heading">Your submissions</h3>
        <div id="mySubmissions"><p class="drawer-fine">Loading...</p></div>
      </div>`;
    loadMySubmissions();
  }

  async function loadMySubmissions() {
    const target = ui.content.querySelector("#mySubmissions");
    if (!target) return;
    const { data, error } = await account.client
      .from("event_submissions")
      .select("id, title, event_date, status, review_note, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      target.innerHTML = '<p class="drawer-fine">Could not load your submissions.</p>';
      return;
    }
    const labels = { pending: "Waiting for approval", approved: "Live on the map", rejected: "Not approved" };
    target.innerHTML = data?.length
      ? data.map((row) => `<div class="submission-row status-${esc(row.status)}">
          <span><strong>${esc(row.title)}</strong><small>${esc(row.event_date)}${row.review_note ? ` / ${esc(row.review_note)}` : ""}</small></span>
          <em>${labels[row.status] || esc(row.status)}</em>
        </div>`).join("")
      : '<p class="drawer-fine">Nothing yet. Your first event will show here.</p>';
  }

  function resizeImage(file, maxSize = 1600) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not read that image"))), "image/jpeg", 0.86);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("That file doesn't look like an image"));
      };
      image.src = url;
    });
  }

  async function submitEvent(form) {
    const errorElement = form.querySelector(".form-error");
    const button = form.querySelector('button[type="submit"]');
    const value = (name) => String(form.elements[name]?.value || "").trim();
    errorElement.textContent = "";

    const title = value("title");
    const location = value("location");
    const date = value("event_date");
    const ticketUrl = value("ticket_url") ? cleanUrl(value("ticket_url")) : "";
    if (title.length < 3) return void (errorElement.textContent = "Add the event name.");
    if (!date || date < todayString()) return void (errorElement.textContent = "Pick a date that hasn't passed.");
    if (location.length < 4) return void (errorElement.textContent = "Add the venue and postcode.");
    if (!/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(location) && !/london/i.test(location)) {
      return void (errorElement.textContent = "Include the venue's postcode so it lands in the right place on the map.");
    }
    if (value("ticket_url") && !ticketUrl) return void (errorElement.textContent = "That ticket link doesn't look right.");

    button.disabled = true;
    button.firstElementChild.textContent = "Sending...";
    try {
      let flyerPath = null;
      const file = form.elements.flyer.files?.[0];
      if (file) {
        if (file.size > 15 * 1024 * 1024) throw new Error("That flyer is too big. Use an image under 15MB.");
        const blob = await resizeImage(file);
        flyerPath = `${account.session.user.id}/${Date.now()}.jpg`;
        const upload = await account.client.storage.from("flyers").upload(flyerPath, blob, { contentType: "image/jpeg", upsert: false });
        if (upload.error) throw upload.error;
      }
      const { error } = await account.client.from("event_submissions").insert({
        user_id: account.session.user.id,
        title,
        event_type: value("event_type"),
        event_date: date,
        location,
        age_range: value("age_range") || "18+",
        price: value("price") || null,
        ticket_url: ticketUrl || null,
        description: value("description") || null,
        tags: value("tags") || null,
        instagram: cleanHandle(value("instagram")) || null,
        contact_email: userEmail() || null,
        flyer_path: flyerPath,
      });
      if (error) throw error;
      native.haptic("MEDIUM");
      app.showToast("Submitted. We'll review it shortly.");
      form.reset();
      form.querySelector(".file-preview").hidden = true;
      loadMySubmissions();
    } catch (error) {
      errorElement.textContent = friendlyError(error);
    } finally {
      button.disabled = false;
      button.firstElementChild.textContent = "Submit for approval";
    }
  }

  // ---------- approvals (admin only) ----------

  async function renderAdmin() {
    ui.content.innerHTML = '<div class="drawer-section"><p class="drawer-fine">Loading...</p></div>';
    let result;
    try {
      result = await api("/api/admin");
    } catch (error) {
      ui.content.innerHTML = `<div class="drawer-section"><p class="drawer-fine">${esc(error.status === 403 ? "This area is only for the Where's The Vibe team." : friendlyError(error))}</p></div>`;
      return;
    }
    const submissions = result.submissions || [];
    const creators = result.creators || [];
    const reports = result.reports || [];
    account.pendingCount = submissions.length + creators.length + reports.length;
    updateMenuButton();
    const actions = (kind, buttons) => `<div class="review-actions">${buttons.map(([action, label, primary]) =>
      `<button type="button" class="${primary ? "drawer-primary" : "drawer-secondary"}" data-review="${action}" data-kind="${kind}"><span>${label}</span></button>`).join("")}</div>`;

    ui.content.innerHTML = `<div class="drawer-section">
      <p class="drawer-lead">${account.pendingCount ? `${account.pendingCount} waiting for review.` : "All caught up."}</p>

      <h3 class="drawer-heading">Reports ${reports.length ? `(${reports.length})` : ""}</h3>
      ${reports.length ? reports.map((row) => `
        <article class="review-card" data-id="${esc(row.id)}">
          ${row.preview_url ? `<img src="${esc(row.preview_url)}" alt="" loading="lazy" />` : ""}
          <div>
            <p class="review-meta">Reported ${esc(new Date(row.created_at).toLocaleDateString("en-GB"))}</p>
            <h4>${esc(row.posts ? "Post" : "Profile")}${row.profiles?.username ? `: @${esc(row.profiles.username)}` : ""}</h4>
            <p class="review-description">"${esc(row.reason)}"</p>
            ${row.posts?.caption ? `<p>${esc(row.posts.caption.slice(0, 200))}</p>` : ""}
            ${actions("report", row.post_id ? [["remove", "Remove post", true], ["dismiss", "Keep it"]] : [["dismiss", "Mark as handled", true]])}
          </div>
        </article>`).join("") : '<p class="drawer-fine">No open reports. Apple expects reports to be dealt with within 24 hours.</p>'}

      <h3 class="drawer-heading">Brand and DJ profiles ${creators.length ? `(${creators.length})` : ""}</h3>
      ${creators.length ? creators.map((row) => `
        <article class="review-card" data-id="${esc(row.id)}">
          ${row.avatar_url ? `<img src="${esc(row.avatar_url)}" alt="" loading="lazy" class="is-round" />` : ""}
          <div>
            <p class="review-meta">${esc(row.account_type === "dj" ? "DJ" : "Brand")}</p>
            <h4>${esc(row.brand_name || row.display_name || "")}</h4>
            <p>@${esc(row.username || "")} / Instagram ${esc(row.instagram || "none")}</p>
            ${row.bio ? `<p class="review-description">${esc(row.bio)}</p>` : ""}
            ${row.instagram ? `<a class="drawer-link" href="https://www.instagram.com/${esc(String(row.instagram).replace(/^@/, ""))}/" target="_blank" rel="noopener">Check their Instagram <span>&nearr;</span></a>` : ""}
            ${actions("creator", [["approve", "Approve", true], ["reject", "Reject"]])}
          </div>
        </article>`).join("") : '<p class="drawer-fine">No profiles waiting.</p>'}

      <h3 class="drawer-heading">Events ${submissions.length ? `(${submissions.length})` : ""}</h3>
      ${submissions.length ? submissions.map((row) => `
        <article class="review-card" data-id="${esc(row.id)}">
          ${row.flyer_url ? `<img src="${esc(row.flyer_url)}" alt="" loading="lazy" />` : ""}
          <div>
            <p class="review-meta">${esc(row.event_type)} / ${esc(row.event_date)} / ${esc(row.age_range)}</p>
            <h4>${esc(row.title)}</h4>
            <p>${esc(row.location)}${row.price ? ` / From ${esc(row.price)}` : ""}</p>
            ${row.description ? `<p class="review-description">${esc(row.description)}</p>` : ""}
            ${row.tags ? `<p class="review-meta">${esc(row.tags)}</p>` : ""}
            <p class="review-meta">${esc(row.instagram || "")} ${esc(row.contact_email || "")}</p>
            ${row.ticket_url ? `<a class="drawer-link" href="${esc(row.ticket_url)}" target="_blank" rel="noopener">Check ticket link <span>&nearr;</span></a>` : '<p class="review-meta">No ticket link</p>'}
            ${actions("submission", [["approve", "Approve", true], ["reject", "Reject"]])}
          </div>
        </article>`).join("") : '<p class="drawer-fine">No events waiting.</p>'}
    </div>`;
  }

  const DONE_TEXT = {
    "submission:approve": "Approved. It will be on the map shortly.",
    "submission:reject": "Rejected.",
    "creator:approve": "Approved. Their profile is now public.",
    "creator:reject": "Rejected.",
    "report:remove": "Post removed.",
    "report:dismiss": "Marked as handled.",
  };

  async function review(card, action, kind) {
    const note = kind === "submission" && action === "reject" ? window.prompt("Reason (shown to the brand, optional):", "") : "";
    if (note === null) return;
    if (kind === "report" && action === "remove" && !window.confirm("Remove this post for everyone?")) return;
    card.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      await api("/api/admin", { method: "POST", body: JSON.stringify({ kind, id: card.dataset.id, action, note }) });
      card.classList.add("is-done");
      card.querySelector(".review-actions").innerHTML = `<p class="review-meta">${DONE_TEXT[`${kind}:${action}`] || "Done."}</p>`;
      account.pendingCount = Math.max(0, account.pendingCount - 1);
      updateMenuButton();
    } catch (error) {
      app.showToast(friendlyError(error));
      card.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  }

  // ---------- events ----------

  ui.button.addEventListener("click", () => (isOpen() ? closeDrawer() : openDrawer()));
  ui.close.addEventListener("click", closeDrawer);
  ui.overlay.addEventListener("click", closeDrawer);
  ui.back.addEventListener("click", goBack);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) closeDrawer();
  });

  ui.content.addEventListener("click", (event) => {
    const target = event.target.closest("[data-view], [data-action], [data-review], #otpResend, #otpChange, #appleSignIn, #signOut, #deleteAccount, #showFavourites");
    if (!target) return;
    if (target.dataset.view) return showView(target.dataset.view);
    if (target.dataset.review) return review(target.closest(".review-card"), target.dataset.review, target.dataset.kind || "submission");
    if (target.dataset.action === "saved") {
      closeDrawer();
      if (!app.state.savedOnly) document.querySelector("#savedButton").click();
      return;
    }
    if (target.dataset.action === "following") {
      closeDrawer();
      location.hash = "#following";
      return;
    }
    if (target.dataset.action === "my-public-profile") {
      closeDrawer();
      return window.VibeSocial?.openProfile(account.profile.id);
    }
    if (target.dataset.action === "blocked") {
      closeDrawer();
      return window.VibeSocial?.openBlocked();
    }
    if (target.id === "otpResend") return sendCode(account.otpEmail, ui.content.querySelector(".form-error"), target);
    if (target.id === "otpChange") {
      account.otpEmail = "";
      return renderSignIn();
    }
    if (target.id === "appleSignIn") return signInWithApple(target);
    if (target.id === "signOut") return account.client.auth.signOut();
    if (target.id === "deleteAccount") return deleteAccount(target);
    if (target.id === "showFavourites") {
      app.applyFavourites(account.prefs.favouriteTypes, account.prefs.favouriteAreas);
      closeDrawer();
      app.showToast("Showing your favourites. Reset filters to see everything.");
    }
  });

  ui.content.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const errorElement = form.querySelector(".form-error");
    const button = form.querySelector('button[type="submit"]');
    if (form.id === "emailForm") return sendCode(form.querySelector("#signinEmail").value, errorElement, button);
    if (form.id === "otpForm") return verifyCode(form.querySelector("#otpCode").value, errorElement, button);
    if (form.id === "submitForm") return submitEvent(form);
    if (form.id === "profileForm") return saveProfile(form);
  });

  ui.content.addEventListener("change", (event) => {
    const form = event.target.closest("form");
    if (form?.id === "prefsForm") return onPrefsChange(form);
    if (event.target.name === "account_type") {
      const creator = event.target.value !== "fan";
      form.querySelectorAll(".creator-fields").forEach((element) => { element.hidden = !creator; });
      form.querySelector(".creator-note").hidden = creator;
    }
    if (event.target.name === "avatar") {
      const file = event.target.files?.[0];
      const holder = form.querySelector(".avatar-lg");
      if (file && holder) holder.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" />`;
    }
    if (event.target.name === "flyer") {
      const file = event.target.files?.[0];
      const preview = form.querySelector(".file-preview");
      preview.hidden = !file;
      if (file) preview.querySelector("img").src = URL.createObjectURL(file);
    }
  });

  // ---------- start ----------

  (async () => {
    await loadLocalPrefs();
    await app.ready;
    applyFavouritesOnOpen();
    await initSupabase();
    document.dispatchEvent(new CustomEvent("vibe:accounts-ready"));
    if (account.prefs.openWithFavourites) applyFavouritesOnOpen();
  })();

  account.showView = (name) => { openDrawer(name); };
  account.isApprovedCreator = isApprovedCreator;
  account.resizeImage = resizeImage;
  account.mediaUrl = mediaUrl;
  account.friendlyError = friendlyError;
  account.signedIn = signedIn;
  window.VibeAccount = account;
})();
