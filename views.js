// Top tabs (Discover, Tonight, This weekend, Following, Map), the Dice-style
// event lists and the Vibe News section.
(function () {
  const app = window.VibeApp;
  if (!app) return;
  const { safeText, safeUrl, colorFor, native } = app;

  const TABS = ["discover", "tonight", "weekend", "following", "map", "search"];
  // Pages reached from the menu rather than a tab.
  const PAGES = ["saved"];
  const VIEWS = [...TABS, ...PAGES];
  const NEWS_LABELS = { hot: "Hot topics", events: "Event news", concerts: "Concert news", latest: "Latest" };
  const DISCOVER_LIMIT = 30;

  const ui = {
    tabs: document.querySelector("#topTabs"),
    views: Object.fromEntries(VIEWS.map((tab) => [tab, document.querySelector(`#view-${tab}`)])),
    savedFeed: document.querySelector("#savedFeed"),
    searchInput: document.querySelector("#searchInput"),
    searchResults: document.querySelector("#searchResults"),
    discoverFeed: document.querySelector("#discoverFeed"),
    tonightFeed: document.querySelector("#tonightFeed"),
    weekendFeed: document.querySelector("#weekendFeed"),
    following: document.querySelector("#followingView"),
    newsSection: document.querySelector("#newsSection"),
    newsFilters: document.querySelector("#newsFilters"),
    newsRail: document.querySelector("#newsRail"),
  };

  let current = "discover";
  let news = [];
  let newsFilter = "all";

  // ---------- dates ----------

  function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  // Friday to Sunday. From Friday onwards it starts today.
  function weekendRange() {
    const now = new Date();
    const day = now.getDay(); // 0 Sun ... 5 Fri, 6 Sat
    const start = day === 0 || day >= 5 ? now : addDays(now, 5 - day);
    const end = day === 0 ? now : addDays(now, 7 - day);
    return [isoDate(start), isoDate(end)];
  }

  function dayHeading(date) {
    const today = app.todayString();
    if (date === today) return "Tonight";
    if (date === isoDate(addDays(new Date(), 1))) return "Tomorrow";
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }

  function upcoming() {
    const today = app.todayString();
    return app.state.events
      .filter((event) => event.date >= today)
      .sort((first, second) => first.date.localeCompare(second.date) || Number(second.vibeApproved) - Number(first.vibeApproved));
  }

  // ---------- event lists ----------

  function feedCard(event) {
    const flyer = safeUrl(event.flyerUrl);
    const saved = app.isSaved(event);
    return `<article class="feed-card" style="--event-color:${colorFor(event.type[0])}">
      <button type="button" class="feed-open" data-event-id="${safeText(event.id)}" aria-label="${safeText(event.title)}, details and tickets">
        <span class="feed-media">${flyer ? `<img src="${flyer}" alt="" loading="lazy" />` : app.placeholderFlyer(event, "is-small")}
          ${event.vibeApproved ? '<img class="feed-approved" src="assets/vibe-approved.png" alt="Vibe approved" />' : ""}</span>
        <span class="feed-info">
          <span class="feed-date">${safeText(app.formatFilterDate(event.date))} / ${safeText(event.type[0])}</span>
          <strong>${safeText(event.title)}</strong>
          <span class="feed-venue">${safeText(app.placeLine(event))}</span>
          <span class="feed-price">${event.price ? `From ${safeText(event.price)}` : "Price TBC"}</span>
        </span>
      </button>
      <button type="button" class="feed-save ${saved ? "is-saved" : ""}" data-save-id="${safeText(event.id)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save event"}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z" /></svg>
      </button>
    </article>`;
  }

  function groupedFeed(events, { grouped = true } = {}) {
    if (!grouped) return `<div class="feed-grid">${events.map(feedCard).join("")}</div>`;
    const days = new Map();
    events.forEach((event) => {
      if (!days.has(event.date)) days.set(event.date, []);
      days.get(event.date).push(event);
    });
    return [...days.entries()].map(([date, items]) => `
      <section class="feed-day">
        <h3 class="feed-day-title">${safeText(dayHeading(date))} <span>${items.length}</span></h3>
        <div class="feed-grid">${items.map(feedCard).join("")}</div>
      </section>`).join("");
  }

  function emptyFeed(title, text, button) {
    return `<div class="feed-empty">
      <h3>${safeText(title)}</h3>
      <p>${safeText(text)}</p>
      ${button ? `<a class="drawer-primary" href="${button[1]}"><span>${safeText(button[0])}</span><span>&rarr;</span></a>` : ""}
    </div>`;
  }

  function sectionHead(title, count, extra = "") {
    return `<div class="section-head"><h2>${safeText(title)} ${count !== undefined ? `<span>${count}</span>` : ""}</h2>${extra}</div>`;
  }

  function renderDiscover() {
    const events = upcoming();
    const shown = events.slice(0, DISCOVER_LIMIT);
    ui.discoverFeed.innerHTML = events.length
      ? `${sectionHead("Coming up", events.length, '<a class="section-link" href="#map">See all on the map &rarr;</a>')}${groupedFeed(shown)}
         ${events.length > shown.length ? `<a class="drawer-secondary feed-more" href="#map">See all ${events.length} events on the map</a>` : ""}`
      : app.state.events.length ? emptyFeed("Nothing coming up", "New events are added every week.") : "";
  }

  function renderTonight() {
    const today = app.todayString();
    const events = upcoming().filter((event) => event.date === today);
    ui.tonightFeed.innerHTML = `${sectionHead("Tonight", events.length)}${events.length
      ? groupedFeed(events, { grouped: false })
      : emptyFeed("Nothing listed for tonight", "Check what's on this weekend instead.", ["This weekend", "#weekend"])}`;
  }

  function renderWeekend() {
    const [start, end] = weekendRange();
    const events = upcoming().filter((event) => event.date >= start && event.date <= end);
    ui.weekendFeed.innerHTML = `${sectionHead("This weekend", events.length)}${events.length
      ? groupedFeed(events)
      : emptyFeed("Nothing listed this weekend yet", "New events land every week. Have a look at the map.", ["Open the map", "#map"])}`;
  }

  function renderSaved() {
    const events = app.savedEvents();
    ui.savedFeed.innerHTML = `${sectionHead("Saved", events.length)}${events.length
      ? groupedFeed(events)
      : emptyFeed("No saved events yet", "Tap the heart on any event to save it. You'll get a reminder before it starts.", ["Find something", "#discover"])}`;
  }

  // ---------- search ----------

  function searchText(event) {
    return [event.title, event.location, event.postcode, event.region, event.description, ...(event.type || []), ...(event.tags || []), ...(event.instagram || [])]
      .join(" ").toLowerCase();
  }

  function renderSearch() {
    const query = (ui.searchInput.value || "").trim().toLowerCase();
    if (!query) {
      const types = [...new Set(upcoming().flatMap((event) => event.type))].sort();
      ui.searchResults.innerHTML = `<p class="search-hint">Search events, venues, postcodes, music, brands and DJs.</p>
        <div class="search-chips">${types.map((type) => `<button type="button" class="chip-button" data-search="${safeText(type)}" style="--event-color:${colorFor(type)}"><i></i>${safeText(type)}</button>`).join("")}</div>`;
      return;
    }
    const words = query.split(/\s+/).filter(Boolean);
    const events = upcoming().filter((event) => {
      const text = searchText(event);
      return words.every((word) => text.includes(word));
    });
    const social = window.VibeSocial?.state;
    const creators = social ? [...social.creators.values()].filter((creator) => !social.blocks.has(creator.id)
      && words.every((word) => `${creator.name} ${creator.username} ${creator.instagram} ${creator.bio || ""}`.toLowerCase().includes(word))) : [];
    ui.searchResults.innerHTML = `
      ${creators.length ? `${sectionHead("Brands and DJs", creators.length)}<div class="creator-list">${creators.slice(0, 8).map((creator) => `
        <div class="creator-card"><button type="button" class="creator-open" data-profile="${safeText(creator.id)}">
          <span class="avatar avatar-md">${safeText((creator.name || "?").slice(0, 1).toUpperCase())}</span>
          <span><strong>${safeText(creator.name)}</strong><small>${creator.account_type === "dj" ? "DJ" : "Brand"} / @${safeText(creator.username)}</small></span>
        </button></div>`).join("")}</div>` : ""}
      ${sectionHead("Events", events.length)}
      ${events.length ? groupedFeed(events) : emptyFeed("No events match", "Try a venue, a postcode like SE15, or a sound like Amapiano.")}`;
  }

  let searchTimer = null;
  ui.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 120);
  });
  ui.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") ui.searchInput.blur();
  });

  function renderFollowing() {
    if (window.VibeSocial) window.VibeSocial.renderFollowing(ui.following);
    else ui.following.innerHTML = emptyFeed("Following", "Loading...");
  }

  function renderCurrent() {
    if (current === "discover") renderDiscover();
    if (current === "tonight") renderTonight();
    if (current === "weekend") renderWeekend();
    if (current === "following") renderFollowing();
    if (current === "saved") renderSaved();
    if (current === "search") renderSearch();
  }

  // ---------- Vibe News ----------

  function timeAgo(timestamp) {
    const then = new Date(timestamp).getTime();
    if (!then) return "";
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    const days = Math.round(hours / 24);
    return days < 7 ? `${days} ${days === 1 ? "day" : "days"} ago` : new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function renderNews() {
    if (!news.length) {
      ui.newsSection.hidden = true;
      return;
    }
    const categories = [...new Set(news.map((item) => item.category))];
    if (newsFilter !== "all" && !categories.includes(newsFilter)) newsFilter = "all";
    ui.newsFilters.innerHTML = categories.length > 1
      ? ["all", ...categories].map((category) => `<button type="button" role="tab" class="chip-button ${newsFilter === category ? "is-active" : ""}" aria-selected="${newsFilter === category}" data-news="${category}">${category === "all" ? "All" : NEWS_LABELS[category]}</button>`).join("")
      : "";
    const items = news.filter((item) => newsFilter === "all" || item.category === newsFilter);
    ui.newsRail.innerHTML = items.map((item) => `
      <a class="news-card" href="${safeText(item.permalink)}" target="_blank" rel="noopener noreferrer">
        <span class="news-media">${safeUrl(item.image)
          ? `<img src="${safeText(item.image)}" alt="" loading="lazy" />`
          : `<span class="news-text-card"><span>${safeText(NEWS_LABELS[item.category] || "Vibe News")}</span><strong>${safeText(item.title || "")}</strong></span>`}${item.type === "VIDEO" ? `<span class="news-play">${app.iconSvg("play")}</span>` : ""}</span>
        <span class="news-label">${safeText(NEWS_LABELS[item.category] || "News")} / ${safeText(timeAgo(item.timestamp))}</span>
        <strong>${safeText(item.title || "View on Instagram")}</strong>
      </a>`).join("");
    ui.newsSection.hidden = false;
    app.setupRailDragScroll(ui.newsRail);
  }

  let lastNewsLoad = 0;
  async function loadNews() {
    lastNewsLoad = Date.now();
    try {
      const response = await fetch(`${native.apiBase}/api/news`, { headers: { Accept: "application/json" } });
      const body = await response.json();
      news = Array.isArray(body.items) ? body.items.filter((item) => safeUrl(item.permalink)) : [];
    } catch {
      news = [];
    }
    renderNews();
  }

  // ---------- tabs ----------

  function showTab(tab, { scroll = true } = {}) {
    if (!VIEWS.includes(tab)) tab = "discover";
    current = tab;
    VIEWS.forEach((name) => {
      ui.views[name].hidden = name !== tab;
      const link = ui.tabs.querySelector(`[data-tab="${name}"]`);
      if (!link) return;
      link.classList.toggle("is-active", name === tab);
      if (name === tab) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.body.dataset.tab = tab;
    if (tab === "map") {
      requestAnimationFrame(() => {
        app.map.invalidateSize();
        app.render();
      });
    }
    renderCurrent();
    const active = ui.tabs.querySelector(".is-active");
    if (active) ui.tabs.scrollTo({ left: active.offsetLeft - (ui.tabs.clientWidth - active.offsetWidth) / 2, behavior: scroll ? "smooth" : "auto" });
    if (scroll) window.scrollTo({ top: 0 });
    if (tab === "search") setTimeout(() => ui.searchInput.focus({ preventScroll: true }), 150);
  }

  function tabFromHash() {
    const tab = location.hash.replace(/^#\/?/, "");
    return VIEWS.includes(tab) ? tab : null;
  }

  // Pick up new posts when the refresh button is pressed or the app is reopened.
  document.querySelector("#refreshButton")?.addEventListener("click", loadNews);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastNewsLoad > 5 * 60000) loadNews();
  });

  window.addEventListener("hashchange", () => {
    const tab = tabFromHash();
    if (tab) {
      native.haptic();
      showTab(tab);
    }
  });

  ui.tabs.addEventListener("click", (event) => {
    const link = event.target.closest("[data-tab]");
    if (link && link.dataset.tab === current) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  document.querySelector(".wordmark")?.setAttribute("href", "#discover");

  document.querySelector("main").addEventListener("click", (event) => {
    const open = event.target.closest(".feed-open");
    if (open) return app.openEventDetail(open.dataset.eventId);
    const save = event.target.closest(".feed-save");
    if (save) {
      app.toggleSaved(save.dataset.saveId).then(() => {
        if (current === "saved") return renderSaved();
        const event = app.findEvent(save.dataset.saveId);
        const saved = Boolean(event && app.isSaved(event));
        save.classList.toggle("is-saved", saved);
        save.setAttribute("aria-pressed", String(saved));
      });
      return;
    }
    const searchChip = event.target.closest("[data-search]");
    if (searchChip) {
      ui.searchInput.value = searchChip.dataset.search;
      renderSearch();
      return;
    }
    const chip = event.target.closest("[data-news]");
    if (chip) {
      newsFilter = chip.dataset.news;
      renderNews();
    }
  });

  // Re-draw lists when events reload or someone signs in or out.
  const previousLoaded = app.hooks.eventsLoaded;
  app.hooks.eventsLoaded = () => {
    previousLoaded();
    renderCurrent();
  };
  document.addEventListener("vibe:auth", () => { if (current === "following") renderFollowing(); });
  document.addEventListener("vibe:following-changed", () => { if (current === "following") renderFollowing(); });

  window.VibeViews = { showTab, current: () => current, feedCard, groupedFeed, emptyFeed, sectionHead, upcoming };

  showTab(tabFromHash() || "discover", { scroll: false });
  // A #map link would otherwise jump to the map element under the tab bar.
  window.scrollTo(0, 0);
  loadNews();
})();
