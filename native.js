// Native bridge for the iPhone and Android apps (Capacitor).
// On the website every helper falls back to the browser version, so the same
// app.js runs in both places. Loaded before app.js.
(function () {
  const capacitor = window.Capacitor;
  const isNative = Boolean(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform());
  const plugins = (capacitor && capacitor.Plugins) || {};
  const SITE_URL = "https://vibeconnoisseur.netlify.app";

  if (isNative) document.documentElement.classList.add("is-native");

  async function haptic(style = "LIGHT") {
    try {
      if (isNative && plugins.Haptics) await plugins.Haptics.impact({ style });
      else if (navigator.vibrate) navigator.vibrate(8);
    } catch {
      // Haptics are a nice-to-have.
    }
  }

  async function getPosition() {
    if (isNative && plugins.Geolocation) {
      const position = await plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
      return { lat: position.coords.latitude, lng: position.coords.longitude };
    }
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not available on this device"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => reject(new Error("Location is switched off for this app")),
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
      );
    });
  }

  // Preferences survives iOS clearing the web view's storage; localStorage is the web fallback.
  const storage = {
    async get(key) {
      try {
        if (isNative && plugins.Preferences) {
          const { value } = await plugins.Preferences.get({ key });
          return value ? JSON.parse(value) : null;
        }
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    },
    async set(key, data) {
      try {
        const value = JSON.stringify(data);
        if (isNative && plugins.Preferences) await plugins.Preferences.set({ key, value });
        else localStorage.setItem(key, value);
      } catch {
        // Storage full or blocked: the app still works for this session.
      }
    },
  };

  function keyHash(key) {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) % 1000000000;
    return hash;
  }

  // Three reminder slots per event: 3 days before, the day before, on the day.
  function notificationIds(key) {
    const hash = keyHash(key) % 700000000;
    return [hash * 3 + 1, hash * 3 + 2, hash * 3 + 3];
  }

  // Ids used by earlier versions of the app, so their reminders can be cancelled too.
  function legacyIds(key) {
    const hash = keyHash(key);
    return [hash * 2 + 1, hash * 2 + 2];
  }

  function localTime(date, hours) {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day, hours, 0, 0);
  }

  // Up to two reminders per saved event: 6pm the day before, and midday on
  // the day. The sheet has dates but no start times, so these are fixed times.
  // Each can be switched off in Preferences.
  async function scheduleReminders(event, key, options = {}) {
    const wantDayBefore = options.dayBefore !== false;
    const wantOnDay = options.onDay !== false;
    const wantThreeDays = options.threeDays === true;
    if (!isNative || !plugins.LocalNotifications) return false;
    try {
      if (!wantDayBefore && !wantOnDay && !wantThreeDays) return false;
      const permission = await plugins.LocalNotifications.requestPermissions();
      if (permission.display !== "granted") return false;

      const [threeDaysId, dayBeforeId, onTheDayId] = notificationIds(key);
      const threeDays = localTime(event.date, 18);
      threeDays.setDate(threeDays.getDate() - 3);
      const dayBefore = localTime(event.date, 18);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const onTheDay = localTime(event.date, 12);
      const now = Date.now();

      const notifications = [
        { id: threeDaysId, at: threeDays, wanted: wantThreeDays, title: "In 3 days", body: `${event.title} is in 3 days. Time to sort tickets and plans.` },
        { id: dayBeforeId, at: dayBefore, wanted: wantDayBefore, title: "Tomorrow", body: `${event.title} is tomorrow. Tickets sorted?` },
        { id: onTheDayId, at: onTheDay, wanted: wantOnDay, title: "Today", body: `${event.title} is today at ${event.location.split(",")[0]}.` },
      ]
        .filter((item) => item.wanted && item.at.getTime() > now)
        .map((item) => ({ id: item.id, title: item.title, body: item.body, schedule: { at: item.at, allowWhileIdle: true }, extra: { eventKey: key } }));

      if (notifications.length) await plugins.LocalNotifications.schedule({ notifications });
      return true;
    } catch {
      return false;
    }
  }

  async function cancelReminders(key) {
    if (!isNative || !plugins.LocalNotifications) return;
    try {
      const ids = [...notificationIds(key), ...legacyIds(key)].map((id) => ({ id }));
      await plugins.LocalNotifications.cancel({ notifications: ids });
    } catch {
      // Nothing scheduled.
    }
  }

  function onReminderTap(handler) {
    if (!isNative || !plugins.LocalNotifications) return;
    try {
      plugins.LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
        const key = action?.notification?.extra?.eventKey;
        if (key) handler(key);
      });
    } catch {
      // Listener not available.
    }
  }

  async function share({ title, text, url }) {
    try {
      if (isNative && plugins.Share) {
        await plugins.Share.share({ title, text, url, dialogTitle: "Share this event" });
        return "shared";
      }
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return "shared";
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      return "copied";
    } catch {
      return "cancelled";
    }
  }

  async function openUrl(url) {
    try {
      if (isNative && plugins.Browser) {
        await plugins.Browser.open({ url, presentationStyle: "popover", toolbarColor: "#11120f" });
        return;
      }
    } catch {
      // Fall through to the browser.
    }
    window.open(url, "_blank", "noopener");
  }

  function randomNonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  // Sign in with Apple (iPhone app only). Apple gets the hashed nonce and
  // Supabase gets the raw one, which is how it checks the token is fresh.
  async function appleSignIn() {
    if (!isNative || !plugins.SignInWithApple) throw new Error("Sign in with Apple is only available in the iPhone app");
    const nonce = randomNonce();
    const result = await plugins.SignInWithApple.authorize({
      clientId: "com.vibeconnoisseur.wheresthevibe",
      redirectURI: "",
      scopes: "email name",
      nonce: await sha256(nonce),
    });
    const response = result?.response || {};
    if (!response.identityToken) throw new Error("Apple did not return a sign-in token");
    return {
      identityToken: response.identityToken,
      nonce,
      name: [response.givenName, response.familyName].filter(Boolean).join(" "),
    };
  }

  async function prepareShell() {
    if (!isNative) return;
    try { await plugins.StatusBar?.setStyle({ style: "DARK" }); } catch { /* optional */ }
  }

  async function appReady() {
    if (!isNative) return;
    try { await plugins.SplashScreen?.hide(); } catch { /* optional */ }
  }

  prepareShell();

  window.VibeNative = {
    isNative,
    apiBase: isNative ? SITE_URL : "",
    siteUrl: SITE_URL,
    haptic,
    getPosition,
    storage,
    scheduleReminders,
    cancelReminders,
    onReminderTap,
    share,
    openUrl,
    appReady,
    appleSignIn,
    canUseApple: isNative && Boolean(plugins.SignInWithApple),
    // The app routes fetch through native code. Supabase allows browser
    // requests, so it can use the web view's own fetch.
    webFetch: (window.CapacitorWebFetch || window.fetch).bind(window),
  };
})();
