const LONDON_CENTER = [51.485, -0.085];
// Every category gets its own colour.
const TYPE_COLORS = {
  "Day Party": "#d7f25a",
  "Night Party": "#e86d4e",
  Concert: "#e58eaa",
  Festival: "#74a7c2",
  Brunch: "#a35ee5",
  "Games Night": "#2ecc71",
  "Games Nights": "#2ecc71",
  "LGBTQ+": "#ff9f43",
  "Sports Event": "#caaa71",
  "Networking Events": "#4fd1c5",
  Other: "#b0b3a8",
};
// For new categories added to the sheet later: distinct from the above.
const EXTRA_COLORS = ["#f7d794", "#778beb", "#f8a5c2", "#63cdda", "#cf6a87", "#e15f41", "#c8d6e5", "#ffd32a"];

const state = {
  events: [],
  markers: new Map(),
  date: "all",
  types: new Set(),
  age: "all",
  regions: new Set(),
  search: "",
  selectedId: null,
  saved: new Map(),
  savedOnly: false,
  userPosition: null,
  nearMe: false,
  offline: false,
};

const native = window.VibeNative || {
  isNative: false, apiBase: "", siteUrl: location.origin, haptic() {}, async getPosition() { throw new Error("Location is not available"); },
  storage: { async get() { return null; }, async set() {} }, async scheduleReminders() { return false; }, async cancelReminders() {},
  onReminderTap() {}, async share() { return "cancelled"; }, openUrl(url) { window.open(url, "_blank", "noopener"); }, appReady() {},
  canUseApple: false, async appleSignIn() { throw new Error("Not available"); }, webFetch: window.fetch.bind(window),
};
const SAVED_KEY = "wtv-saved-events";
const CACHE_KEY = "wtv-events-cache";

const elements = {
  ageFilter: document.querySelector("#ageFilter"),
  clearFilters: document.querySelector("#clearFilters"),
  closeRail: document.querySelector("#closeRail"),
  detailBody: document.querySelector("#detailBody"),
  detailClose: document.querySelector("#detailClose"),
  detailOverlay: document.querySelector("#detailOverlay"),
  flyerShowcases: document.querySelector("#flyerShowcases"),
  toast: document.querySelector("#toast"),
  dateFilter: document.querySelector("#dateFilter"),
  emptyReset: document.querySelector("#emptyReset"),
  emptyState: document.querySelector("#emptyState"),
  eventList: document.querySelector("#eventList"),
  eventRail: document.querySelector("#eventRail"),
  locationToggle: document.querySelector("#locationFilterToggle"),
  locationPanel: document.querySelector("#locationFilterPanel"),
  mapKey: document.querySelector("#mapKey"),
  nearMeButton: document.querySelector("#nearMeButton"),
  savedButton: document.querySelector("#savedButton"),
  savedCount: document.querySelector("#savedCount"),
  railTitle: document.querySelector("#railTitle"),
  emptyTitle: document.querySelector("#emptyTitle"),
  mobileCount: document.querySelector("#mobileCount"),
  mobileListButton: document.querySelector("#mobileListButton"),
  refreshButton: document.querySelector("#refreshButton"),
  resultCount: document.querySelector("#resultCount"),
  searchInput: document.querySelector("#searchInput"),
  syncStatus: document.querySelector("#syncStatus"),
  typeToggle: document.querySelector("#typeFilterToggle"),
  typePanel: document.querySelector("#typeFilterPanel"),
};

const map = L.map("map", {
  zoomControl: false,
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
  touchZoom: true,
  bounceAtZoomLimits: false,
  attributionControl: true,
}).setView(LONDON_CENTER, 11);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png?key=cb1_3iig_1_6ba0b59ce226c79612dcb36b", {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
  maxZoom: 20,
  subdomains: "abcd",
}).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=cb1_3iig_1_6ba0b59ce226c79612dcb36b", {
  maxZoom: 20,
  subdomains: "abcd",
  pane: "shadowPane",
}).addTo(map);

// No emojis anywhere in the text: strip them, along with their joiners.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3]/gu;
function stripEmoji(value = "") {
  return String(value ?? "").replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/^ +| +$/gm, "");
}

function safeText(value = "") {
  const node = document.createElement("div");
  node.textContent = stripEmoji(value);
  return node.innerHTML;
}

function safeUrl(value = "") {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function colorFor(type) {
  if (!type) return TYPE_COLORS.Other;
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  let hash = 0;
  for (const character of type) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return EXTRA_COLORS[hash % EXTRA_COLORS.length];
}

// Simple drawn shapes instead of symbols, which iPhones turn into emoji.
const ICONS = {
  "arrow-up-right": '<path d="M7 17 17 7M9 7h8v8" />',
  play: '<path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" stroke="none" />',
  stack: '<rect x="7" y="7" width="12" height="12" /><path d="M4 16V4h12" />',
};
function iconSvg(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// "Venue, POSTCODE" for flyers and lists.
function placeLine(event) {
  const venue = (event.location || "").split(",")[0].trim();
  const postcode = (event.postcode || "").trim();
  if (!postcode || venue.toUpperCase().includes(postcode.toUpperCase())) return venue;
  return `${venue}, ${postcode}`;
}

function dateObject(value) {
  return new Date(`${value}T12:00:00Z`);
}

function formatFullDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateObject(value));
}

function formatFilterDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateObject(value));
}

function dateParts(value) {
  const date = dateObject(value);
  return {
    day: new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" }).format(date),
    month: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date),
  };
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function eventKey(event) {
  return `${slugify(event.title)}-${event.date}`;
}

function isSaved(event) {
  return state.saved.has(eventKey(event));
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function distanceKm(event) {
  if (!state.userPosition) return null;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(event.latitude - state.userPosition.lat);
  const dLng = toRad(event.longitude - state.userPosition.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(state.userPosition.lat)) * Math.cos(toRad(event.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km === null) return "";
  const miles = km * 0.621371;
  return miles < 0.1 ? "Right here" : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

function savedEvents() {
  const today = todayString();
  const live = new Map(state.events.map((event) => [eventKey(event), event]));
  return [...state.saved.entries()]
    .map(([key, stored]) => live.get(key) || stored)
    .filter((event) => event.date >= today)
    .sort((first, second) => first.date.localeCompare(second.date));
}

function matchesSearch(event, query) {
  if (!query) return true;
  const haystack = [
    event.title,
    event.location,
    event.region,
    event.ageRange,
    ...(event.type || []),
    ...(event.tags || []),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function filteredEvents() {
  const events = state.savedOnly ? savedEvents() : baseFilteredEvents();
  if (state.nearMe && state.userPosition) {
    return [...events].sort((first, second) => distanceKm(first) - distanceKm(second));
  }
  return events;
}

function baseFilteredEvents() {
  const query = state.search.trim().toLowerCase();
  return state.events.filter((event) => {
    const matchesDate = state.date === "all" || event.date === state.date;
    const matchesAge = state.age === "all" || event.ageRange === state.age;
    const matchesType =
      state.types.size === 0
      || event.type.some((type) => state.types.has(type))
      || (state.types.has("Vibe Approved") && event.vibeApproved);
    const matchesRegion = state.regions.size === 0 || state.regions.has(event.region);
    return matchesDate && matchesAge && matchesType && matchesRegion && matchesSearch(event, query);
  });
}

function markerIcon(event) {
  return L.divIcon({
    className: "event-marker-wrap",
    html: `<div class="event-marker" style="--marker-color:${colorFor(event.type[0])}"></div>`,
    iconSize: [26, 30],
    iconAnchor: [11, 27],
    popupAnchor: [0, -27],
  });
}

function popupMarkup(event) {
  const ticketUrl = safeUrl(event.ticketUrl);
  const typeLabel = event.type.join(" / ");
  const flyerUrl = safeUrl(event.flyerUrl);
  return `<article class="popup-card ${event.vibeApproved ? "approved" : ""} ${flyerUrl ? "has-flyer" : ""}" style="--event-color:${colorFor(event.type[0])}">
    ${flyerUrl ? `<button type="button" class="popup-flyer" data-action="details" data-event-id="${safeText(event.id)}" aria-label="View flyer and details"><img src="${flyerUrl}" alt="" loading="lazy" /></button>` : ""}
    ${event.vibeApproved ? '<img class="popup-approved" src="assets/vibe-approved.png" alt="Vibe approved" />' : ""}
    <p class="popup-label">${safeText(typeLabel)} / ${safeText(formatFullDate(event.date))}</p>
    <h2>${safeText(event.title)}</h2>
    <p class="popup-meta">${safeText(event.location)}</p>
    <div class="popup-facts"><span>${safeText(event.region)}</span><span>${safeText(event.ageRange)}</span><span>From ${safeText(event.price)}</span></div>
    ${event.tags?.length ? `<div class="popup-tags">${event.tags.map((tag) => `<span>${safeText(tag)}</span>`).join("")}</div>` : ""}
    <div class="popup-actions">
      <button type="button" class="popup-action ${isSaved(event) ? "is-saved" : ""}" data-action="save" data-event-id="${safeText(event.id)}">${isSaved(event) ? "Saved" : "Save"}</button>
      <button type="button" class="popup-action" data-action="share" data-event-id="${safeText(event.id)}">Share</button>
    </div>
    <button type="button" class="popup-link" data-action="details" data-event-id="${safeText(event.id)}"><span>${ticketUrl ? "Details &amp; tickets" : "Details"}</span>${iconSvg("arrow-up-right")}</button>
  </article>`;
}

function renderMap(events, keepView = false) {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  events.forEach((event) => {
    const marker = L.marker([event.latitude, event.longitude], {
      icon: markerIcon(event),
      title: event.title,
      riseOnHover: true,
    }).addTo(map);

    marker.bindPopup(popupMarkup(event), {
      closeButton: true,
      maxWidth: 240,
      offset: [0, -2],
      // Keep the popup clear of the buttons floating over the top of the map.
      autoPanPaddingTopLeft: L.point(20, 80),
      autoPanPaddingBottomRight: L.point(20, 30),
    });
    // On phones a map pop-up gets squeezed under the buttons, so open the
    // full event pop-up from the bottom instead.
    marker.on("click", () => {
      if (window.innerWidth <= 760) {
        marker.closePopup();
        state.selectedId = event.id;
        openEventDetail(event.id);
        return;
      }
      selectEvent(event.id, false);
    });
    marker.on("popupclose", () => clearSelection());
    state.markers.set(event.id, marker);
  });

  if (keepView) return;

  if (state.nearMe && state.userPosition) {
    const nearest = events.slice(0, 5).map((event) => [event.latitude, event.longitude]);
    const bounds = L.latLngBounds([[state.userPosition.lat, state.userPosition.lng], ...nearest]);
    map.fitBounds(bounds, { padding: [55, 55], maxZoom: 14, animate: true });
    return;
  }

  if (events.length === 1) map.setView([events[0].latitude, events[0].longitude], 14, { animate: true });
  if (events.length > 1) {
    const bounds = L.latLngBounds(events.map((event) => [event.latitude, event.longitude]));
    map.fitBounds(bounds, { padding: [55, 55], maxZoom: 12, animate: true });
  }
}

function renderCards(events) {
  elements.eventList.innerHTML = events.map((event, index) => {
    const parts = dateParts(event.date);
    const typeLabel = event.type.join(" / ");
    const saved = isSaved(event);
    const distance = formatDistance(distanceKm(event));
    const flyerUrl = safeUrl(event.flyerUrl);
    return `<div class="event-card-wrap" style="--event-color:${colorFor(event.type[0])}">
    <button class="event-card ${state.selectedId === event.id ? "active" : ""}" data-event-id="${safeText(event.id)}" type="button" style="--event-color:${colorFor(event.type[0])};animation-delay:${index * 45}ms">
      <span class="card-date">${parts.day}<small>${parts.month}</small></span>
      <span>
        <span class="card-type">${safeText(typeLabel)}${event.vibeApproved ? '<img class="card-approved" src="assets/vibe-approved.png" alt="Vibe approved" />' : ""}</span>
        <h2>${safeText(event.title)}</h2>
        <span class="card-location">${safeText(event.location)}</span>
        ${event.tags?.length ? `<span class="card-tags">${event.tags.map((tag) => `<span>${safeText(tag)}</span>`).join("")}</span>` : ""}
        <span class="card-bottom"><span>${distance ? `${safeText(distance)} · ` : ""}${safeText(event.region)} · ${safeText(event.ageRange)}</span><span>From ${safeText(event.price)}</span></span>
      </span>
      ${flyerUrl ? `<img class="card-flyer" src="${flyerUrl}" alt="" loading="lazy" />` : ""}
    </button>
    <button class="card-details" type="button" data-event-id="${safeText(event.id)}">Details &amp; tickets ${iconSvg("arrow-up-right")}</button>
    <button class="card-save ${saved ? "is-saved" : ""}" type="button" data-event-id="${safeText(event.id)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save event"}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z" /></svg>
    </button>
    </div>`;
  }).join("");

  elements.eventList.querySelectorAll(".event-card").forEach((card) => {
    card.addEventListener("click", () => selectEvent(card.dataset.eventId, true));
  });

  elements.eventList.querySelectorAll(".card-save").forEach((button) => {
    button.addEventListener("click", () => toggleSaved(button.dataset.eventId));
  });

  elements.eventList.querySelectorAll(".card-details").forEach((button) => {
    button.addEventListener("click", () => openEventDetail(button.dataset.eventId));
  });
}

function renderKey(events) {
  const types = [...new Set(events.flatMap((event) => event.type))];
  elements.mapKey.innerHTML = types.map((type) =>
    `<span class="key-item"><span class="key-dot" style="background:${colorFor(type)}"></span>${safeText(type)}</span>`,
  ).join("");
}

// Every event gets a flyer. Without an image, one is drawn from its details.
function placeholderFlyer(event, extraClass = "") {
  return `<span class="flyer-card-image flyer-placeholder ${extraClass}" style="--event-color:${colorFor(event.type[0])}" aria-hidden="true">
    <span class="ph-top">${safeText(event.type[0])}</span>
    <strong>${safeText(event.title)}</strong>
    <span class="ph-bottom"><b>${safeText(formatFilterDate(event.date))}</b>${safeText(placeLine(event))}</span>
  </span>`;
}

function flyerCardMarkup(event) {
  const flyerUrl = safeUrl(event.flyerUrl);
  const image = flyerUrl
    ? `<img class="flyer-card-image" src="${flyerUrl}" alt="" loading="lazy" draggable="false" />`
    : placeholderFlyer(event);
  return `<button type="button" class="flyer-card" data-event-id="${safeText(event.id)}" style="--event-color:${colorFor(event.type[0])}">
    <span class="flyer-card-frame">
      ${image}
      ${event.vibeApproved ? '<img class="flyer-card-approved" src="assets/vibe-approved.png" alt="Vibe approved" draggable="false" />' : ""}
    </span>
    <span class="flyer-card-body">
      <span class="flyer-card-type">${safeText(formatFilterDate(event.date))}</span>
      <h3>${safeText(event.title)}</h3>
      <span class="flyer-card-place">${safeText(placeLine(event))}</span>
    </span>
  </button>`;
}

// Flyer rails only for Vibe Approved and Concerts. Every other event still
// shows its flyer in the lists and pop-ups.
function flyerGroups() {
  const today = todayString();
  const upcoming = state.events.filter((event) => event.date >= today);
  const withFlyerFirst = (events) => [...events].sort((first, second) =>
    Number(Boolean(second.flyerUrl)) - Number(Boolean(first.flyerUrl)) || first.date.localeCompare(second.date));
  return [
    { title: "Vibe Approved", events: withFlyerFirst(upcoming.filter((event) => event.vibeApproved)) },
    { title: "Concerts", events: withFlyerFirst(upcoming.filter((event) => event.type.includes("Concert"))) },
  ].filter((group) => group.events.length);
}

function renderFlyerShowcases() {
  elements.flyerShowcases.innerHTML = flyerGroups().map((group, index) => `
    <section class="flyer-showcase" aria-label="${safeText(group.title)} events">
      <h2 class="flyer-showcase-title">${safeText(group.title)} <span>${group.events.length}</span></h2>
      <div class="flyer-rail" data-rail="${index}">${group.events.map(flyerCardMarkup).join("")}</div>
      <div class="flyer-rail-scrubber">
        <input type="range" min="0" max="0" value="0" step="1" aria-label="Scroll ${safeText(group.title)} flyers" />
      </div>
    </section>`).join("");

  elements.flyerShowcases.querySelectorAll(".flyer-showcase").forEach((section) => {
    const rail = section.querySelector(".flyer-rail");
    const scrubber = section.querySelector("input[type=range]");
    setupRailDragScroll(rail);
    bindRailScrubber(rail, scrubber);
    syncRailScrubber(rail, scrubber);
    rail.querySelectorAll(".flyer-card").forEach((card) => {
      card.addEventListener("click", () => openEventDetail(card.dataset.eventId));
    });
    rail.querySelectorAll("img.flyer-card-image").forEach((image) => {
      image.addEventListener("error", () => image.replaceWith(Object.assign(document.createElement("span"), { className: "flyer-card-image flyer-placeholder" })), { once: true });
    });
  });
}

// Desktop-only visible slider (hidden on mobile via CSS, where native touch
// scrolling is left untouched). Keeps the slider's range in sync with how
// far the row can actually scroll, and keeps slider <-> rail position
// mirrored in both directions.
function syncRailScrubber(rail, scrubber) {
  const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
  scrubber.max = String(max);
  scrubber.value = String(rail.scrollLeft);
  scrubber.disabled = max === 0;
}

function bindRailScrubber(rail, scrubber) {
  scrubber.addEventListener("input", () => {
    rail.scrollLeft = Number(scrubber.value);
  });

  rail.addEventListener("scroll", () => {
    scrubber.value = String(rail.scrollLeft);
  });

  window.addEventListener("resize", () => syncRailScrubber(rail, scrubber));
}

// Flyer cards are <a> links, which browsers try to native-drag by default —
// that swallows mouse-drag gestures instead of scrolling the row. This adds
// manual click-and-drag scrolling, plus converts a plain vertical mouse
// wheel into horizontal movement so trackpads/mice without native
// horizontal scroll support still work.
function setupRailDragScroll(rail) {
  let isDragging = false;
  let dragMoved = false;
  let startX = 0;
  let startScrollLeft = 0;

  rail.addEventListener("mousedown", (event) => {
    isDragging = true;
    dragMoved = false;
    startX = event.pageX;
    startScrollLeft = rail.scrollLeft;
    rail.classList.add("is-dragging");
  });

  window.addEventListener("mousemove", (event) => {
    if (!isDragging) return;
    const delta = event.pageX - startX;
    if (Math.abs(delta) > 4) dragMoved = true;
    rail.scrollLeft = startScrollLeft - delta;
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
    rail.classList.remove("is-dragging");
  });

  // If the mouse actually dragged (not just clicked), swallow the
  // resulting click so it doesn't also open the card's link.
  rail.addEventListener("click", (event) => {
    if (dragMoved) {
      event.preventDefault();
      dragMoved = false;
    }
  }, true);

  rail.addEventListener("wheel", (event) => {
    if (event.deltaX !== 0) return;
    event.preventDefault();
    rail.scrollLeft += event.deltaY;
  }, { passive: false });
}


function render(keepView = false) {
  const events = filteredEvents();
  if (!events.some((event) => event.id === state.selectedId)) state.selectedId = null;

  renderMap(events, keepView);
  renderCards(events);
  renderKey(events);

  elements.resultCount.textContent = events.length;
  elements.mobileCount.textContent = events.length;
  elements.railTitle.textContent = state.savedOnly ? "saved" : "selected";
  elements.emptyTitle.textContent = state.savedOnly
    ? "No saved events yet. Tap the heart on any event."
    : "Nothing matches that combination.";
  updateToolButtons();
  elements.emptyState.hidden = events.length !== 0;
  document.querySelector(".map-section").hidden = events.length === 0;
}

function findEvent(id) {
  return state.events.find((event) => event.id === id) || savedEvents().find((event) => event.id === id);
}

function updateToolButtons() {
  const savedTotal = savedEvents().length;
  elements.savedCount.textContent = savedTotal;
  elements.savedButton.classList.toggle("is-on", state.savedOnly);
  elements.savedButton.setAttribute("aria-pressed", String(state.savedOnly));
  elements.nearMeButton.classList.toggle("is-on", state.nearMe);
  elements.nearMeButton.setAttribute("aria-pressed", String(state.nearMe));
}

// account.js plugs into these to sync saves and apply preferences.
const hooks = {
  savedChanged() {},
  reminderOptions() { return { dayBefore: true, onDay: true }; },
  detailExtras() { return ""; },
  canSave() { return true; },
  eventsLoaded() {},
};

let toastTimer = null;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  requestAnimationFrame(() => elements.toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("show");
    setTimeout(() => { elements.toast.hidden = true; }, 250);
  }, 2600);
}

// Event detail pop-up: flyer, description and details, shown before
// anyone leaves for the ticket site.
function detailMarkup(event) {
  const ticketUrl = safeUrl(event.ticketUrl);
  const flyerUrl = safeUrl(event.flyerUrl);
  const saved = isSaved(event);
  const description = event.description
    || `${event.title} at ${event.location.split(",")[0]}. Full details and ticket options are on the ticket page.`;
  return `<article class="detail-card" style="--event-color:${colorFor(event.type[0])}">
    <div class="detail-flyer">${flyerUrl ? `<img src="${flyerUrl}" alt="Flyer for ${safeText(event.title)}" />` : placeholderFlyer(event, "is-large")}</div>
    <div class="detail-text">
      <p class="detail-label">${safeText(event.type.join(" / "))} / ${safeText(formatFullDate(event.date))}</p>
      <h2 id="detailTitle">${safeText(event.title)}${event.vibeApproved ? '<img class="detail-approved" src="assets/vibe-approved.png" alt="Vibe approved" />' : ""}</h2>
      <p class="detail-location">${safeText(event.location)}</p>
      <div class="detail-facts"><span>${safeText(event.region)}</span><span>${safeText(event.ageRange)}</span><span>From ${safeText(event.price)}</span></div>
      <p class="detail-description">${safeText(description)}</p>
      ${event.tags?.length ? `<div class="detail-tags">${event.tags.map((tag) => `<span>${safeText(tag)}</span>`).join("")}</div>` : ""}
      ${hooks.detailExtras(event)}
      <div class="detail-actions">
        <button type="button" class="detail-secondary ${saved ? "is-saved" : ""}" data-detail-action="save" data-event-id="${safeText(event.id)}">${saved ? "Saved" : "Save"}</button>
        <button type="button" class="detail-secondary" data-detail-action="share" data-event-id="${safeText(event.id)}">Share</button>
      </div>
      ${ticketUrl
        ? `<a class="detail-tickets" href="${ticketUrl}" target="_blank" rel="noopener noreferrer"><span>Continue to tickets</span>${iconSvg("arrow-up-right")}</a>
           <p class="detail-fine">Tickets are sold by the organiser's ticket site.</p>`
        : '<p class="detail-tickets is-disabled"><span>Tickets not live yet</span></p><p class="detail-fine">Save it and we will remind you closer to the date.</p>'}
    </div>
  </article>`;
}

let detailReturnFocus = null;

function openEventDetail(id) {
  const event = findEvent(id);
  if (!event) return;
  native.haptic();
  detailReturnFocus = document.activeElement;
  elements.detailBody.innerHTML = detailMarkup(event);
  elements.detailOverlay.hidden = false;
  document.body.classList.add("detail-open");
  requestAnimationFrame(() => elements.detailOverlay.classList.add("show"));
  elements.detailClose.focus();
}

function closeEventDetail() {
  elements.detailOverlay.classList.remove("show");
  document.body.classList.remove("detail-open");
  setTimeout(() => { elements.detailOverlay.hidden = true; }, 200);
  detailReturnFocus?.focus?.();
}

function refreshDetailSaveButton(id) {
  if (elements.detailOverlay.hidden) return;
  const button = elements.detailBody.querySelector(`[data-detail-action="save"][data-event-id="${CSS.escape(id)}"]`);
  const event = findEvent(id);
  if (!button || !event) return;
  const saved = isSaved(event);
  button.classList.toggle("is-saved", saved);
  button.textContent = saved ? "Saved" : "Save";
}

async function persistSaved() {
  await native.storage.set(SAVED_KEY, [...state.saved.entries()]);
}

async function toggleSaved(id) {
  const event = findEvent(id);
  if (!event) return;
  const key = eventKey(event);
  // Saving needs an account. Signed-out people are sent to sign in, and the
  // event is saved for them once they have.
  if (!state.saved.has(key) && !hooks.canSave(() => toggleSaved(id))) return;
  native.haptic(state.saved.has(key) ? "LIGHT" : "MEDIUM");

  if (state.saved.has(key)) {
    state.saved.delete(key);
    native.cancelReminders(key);
    hooks.savedChanged(key, null);
  } else {
    const { ...copy } = event;
    state.saved.set(key, copy);
    native.scheduleReminders(event, key, hooks.reminderOptions());
    hooks.savedChanged(key, copy);
    showToast("Saved. We'll remind you before it starts.");
  }

  await persistSaved();
  refreshDetailSaveButton(id);
  document.dispatchEvent(new CustomEvent("vibe:saved", { detail: { id } }));
  const marker = state.markers.get(id);
  const popupWasOpen = marker?.isPopupOpen();
  render(true);
  if (popupWasOpen) state.markers.get(id)?.openPopup();
}

async function shareEvent(id) {
  const event = findEvent(id);
  if (!event) return;
  native.haptic();
  const url = `${native.siteUrl}/?event=${encodeURIComponent(eventKey(event))}`;
  const result = await native.share({
    title: event.title,
    text: `${event.title}, ${formatFilterDate(event.date)} at ${event.location.split(",")[0]}. Found on Where's The Vibe.`,
    url,
  });
  if (result === "copied") setStatus("Link copied", false);
}

async function toggleNearMe() {
  if (state.nearMe) {
    state.nearMe = false;
    userMarker?.remove();
    render();
    return;
  }

  elements.nearMeButton.disabled = true;
  elements.nearMeButton.lastElementChild.textContent = "Finding you";
  try {
    state.userPosition = await native.getPosition();
    state.nearMe = true;
    native.haptic();
    showUserMarker();
    render();
    openMobileRail();
  } catch (error) {
    setStatus(error.message || "Could not find your location", true);
  } finally {
    elements.nearMeButton.disabled = false;
    elements.nearMeButton.lastElementChild.textContent = "Near me";
  }
}

let userMarker = null;

function showUserMarker() {
  userMarker?.remove();
  userMarker = L.marker([state.userPosition.lat, state.userPosition.lng], {
    icon: L.divIcon({ className: "user-marker-wrap", html: '<span class="user-marker"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    interactive: false,
    keyboard: false,
  }).addTo(map);
}

function toggleSavedOnly() {
  if (!state.savedOnly && !hooks.canSave(() => toggleSavedOnly())) return;
  state.savedOnly = !state.savedOnly;
  native.haptic();
  render();
  if (state.savedOnly) openMobileRail();
}

function setStatus(message, isError) {
  elements.syncStatus.classList.toggle("error", isError);
  elements.syncStatus.lastElementChild.textContent = message;
}

function selectEvent(id, openPopup) {
  state.selectedId = id;
  native.haptic();
  document.querySelectorAll(".event-card").forEach((card) => card.classList.toggle("active", card.dataset.eventId === id));
  state.markers.forEach((marker, markerId) => marker.getElement()?.classList.toggle("is-active", markerId === id));

  const marker = state.markers.get(id);
  if (marker) {
    // Centre slightly above the pin so the pop-up above it has room.
    const zoom = Math.max(map.getZoom(), 13);
    const target = window.innerWidth > 760
      ? map.unproject(map.project(marker.getLatLng(), zoom).subtract([0, map.getSize().y * 0.24]), zoom)
      : marker.getLatLng();
    map.flyTo(target, zoom, { duration: 0.65 });
    // Open after the fly-to settles so the popup can pan itself fully into view.
    if (openPopup) {
      if (window.innerWidth <= 760) setTimeout(() => openEventDetail(id), 450);
      else setTimeout(() => state.markers.get(id)?.openPopup(), 700);
    }
  }

  if (window.innerWidth <= 760) closeMobileRail();
}

function clearSelection() {
  state.selectedId = null;
  document.querySelectorAll(".event-card").forEach((card) => card.classList.remove("active"));
  state.markers.forEach((marker) => marker.getElement()?.classList.remove("is-active"));
}

function populateSelect(select, values, formatter = (value) => value) {
  const firstOption = select.options[0];
  select.replaceChildren(firstOption, ...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatter(value);
    return option;
  }));
}

function updateToggleLabel(toggle, values, allLabel) {
  if (values.size === 0) {
    toggle.textContent = allLabel;
    toggle.classList.remove("has-selection");
    return;
  }
  toggle.textContent = values.size === 1 ? [...values][0] : `${values.size} selected`;
  toggle.classList.add("has-selection");
}

function buildMultiselect(panel, toggle, values, stateSet, allLabel) {
  panel.innerHTML = values.map((value) => {
    const id = `${panel.id}-${slugify(value)}`;
    return `<label class="multiselect-option" for="${id}">
      <input type="checkbox" id="${id}" value="${safeText(value)}" ${stateSet.has(value) ? "checked" : ""} />
      <span>${safeText(value)}</span>
    </label>`;
  }).join("");

  panel.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) stateSet.add(checkbox.value);
      else stateSet.delete(checkbox.value);
      updateToggleLabel(toggle, stateSet, allLabel);
      render();
    });
  });

  updateToggleLabel(toggle, stateSet, allLabel);
}

function closeAllDropdowns() {
  document.querySelectorAll(".multiselect-panel").forEach((panel) => { panel.hidden = true; });
  document.querySelectorAll(".multiselect-toggle").forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
}

function setupDropdown(toggle, panel) {
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = !panel.hidden;
    closeAllDropdowns();
    panel.hidden = wasOpen;
    toggle.setAttribute("aria-expanded", String(!wasOpen));
  });
  panel.addEventListener("click", (event) => event.stopPropagation());
}

document.addEventListener("click", closeAllDropdowns);

function populateFilters() {
  const dates = [...new Set(state.events.map((event) => event.date))].sort();
  const types = [...new Set(state.events.flatMap((event) => event.type))].sort();
  types.push("Vibe Approved");
  const ages = [...new Set(state.events.map((event) => event.ageRange))].sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
  const regionOrder = ["North London", "North West London", "East London", "South London", "West London"];
  const regions = regionOrder.filter((region) => state.events.some((event) => event.region === region));

  populateSelect(elements.dateFilter, dates, formatFilterDate);
  populateSelect(elements.ageFilter, ages);
  buildMultiselect(elements.typePanel, elements.typeToggle, types, state.types, "All event types");
  buildMultiselect(elements.locationPanel, elements.locationToggle, regions, state.regions, "All London");
}

function resetFilters() {
  state.date = "all";
  state.age = "all";
  state.types.clear();
  state.regions.clear();
  state.search = "";
  elements.dateFilter.value = "all";
  elements.ageFilter.value = "all";
  elements.searchInput.value = "";
  populateFilters();
  render();
}

function openMobileRail() {
  elements.eventRail.classList.add("open");
  elements.mobileListButton.setAttribute("aria-expanded", "true");
}

function closeMobileRail() {
  elements.eventRail.classList.remove("open");
  elements.mobileListButton.setAttribute("aria-expanded", "false");
}

function setLoading(isLoading) {
  elements.refreshButton.classList.toggle("loading", isLoading);
  elements.refreshButton.disabled = isLoading;
}

async function loadEvents() {
  setLoading(true);
  elements.syncStatus.classList.remove("error");
  elements.syncStatus.lastElementChild.textContent = "Reading the guest list";

  try {
    const response = await fetch(`${native.apiBase}/api/events`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load events");

    state.events = Array.isArray(payload.events) ? payload.events : [];
    state.offline = false;
    native.storage.set(CACHE_KEY, { events: state.events, at: Date.now() });
    populateFilters();
    renderFlyerShowcases();
    render();
    hooks.eventsLoaded();
    elements.syncStatus.lastElementChild.textContent = `${state.events.length} events live on the map`;
  } catch (error) {
    const cached = await native.storage.get(CACHE_KEY);
    if (cached?.events?.length && !state.events.length) {
      const today = todayString();
      state.events = cached.events.filter((event) => event.date >= today);
      state.offline = true;
      populateFilters();
      renderFlyerShowcases();
      render();
      hooks.eventsLoaded();
      setStatus("Offline. Showing your last update", true);
    } else {
      setStatus(error.message === "Failed to fetch" ? "You're offline. Saved events still work" : (error.message || "The event feed is offline"), true);
      render();
    }
  } finally {
    setLoading(false);
    native.appReady();
  }
}

function openEventFromLink(key) {
  const event = state.events.find((item) => eventKey(item) === key) || state.saved.get(key);
  if (!event) return;
  if (!filteredEvents().some((item) => item.id === event.id)) {
    resetFilters();
    if (!state.events.some((item) => item.id === event.id)) {
      state.savedOnly = true;
      render();
    }
  }
  setTimeout(() => selectEvent(event.id, true), 300);
}

elements.dateFilter.addEventListener("change", (event) => { state.date = event.target.value; render(); });
elements.ageFilter.addEventListener("change", (event) => { state.age = event.target.value; render(); });
elements.searchInput.addEventListener("input", (event) => { state.search = event.target.value; render(); });
elements.clearFilters.addEventListener("click", resetFilters);
elements.emptyReset.addEventListener("click", resetFilters);
elements.refreshButton.addEventListener("click", loadEvents);
elements.mobileListButton.addEventListener("click", openMobileRail);
elements.closeRail.addEventListener("click", closeMobileRail);
elements.nearMeButton.addEventListener("click", toggleNearMe);
elements.savedButton.addEventListener("click", toggleSavedOnly);

map.on("popupopen", (event) => {
  // Re-check the fit once the flyer has loaded, so the pop-up stays in view.
  event.popup.getElement()?.querySelectorAll("img").forEach((image) => {
    if (!image.complete) image.addEventListener("load", () => { event.popup.update(); }, { once: true });
  });
  event.popup.getElement()?.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.action === "save") toggleSaved(button.dataset.eventId);
      if (button.dataset.action === "share") shareEvent(button.dataset.eventId);
      if (button.dataset.action === "details") openEventDetail(button.dataset.eventId);
    });
  });
});

// In the app, ticket and flyer links open in an in-app browser sheet instead of leaving the app.
document.addEventListener("click", (event) => {
  if (!native.isNative || event.defaultPrevented) return;
  const link = event.target.closest?.('a[target="_blank"]');
  const url = link && safeUrl(link.href);
  if (!url) return;
  event.preventDefault();
  native.openUrl(url);
});
elements.detailClose.addEventListener("click", closeEventDetail);
elements.detailOverlay.addEventListener("click", (event) => {
  if (event.target === elements.detailOverlay) closeEventDetail();
});
elements.detailBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-detail-action]");
  if (!button) return;
  if (button.dataset.detailAction === "save") toggleSaved(button.dataset.eventId);
  if (button.dataset.detailAction === "share") shareEvent(button.dataset.eventId);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.detailOverlay.hidden) closeEventDetail();
});

setupDropdown(elements.typeToggle, elements.typePanel);
setupDropdown(elements.locationToggle, elements.locationPanel);

const mapPanel = document.querySelector(".map-panel");
const mapElement = document.querySelector("#map");

function updatePinchState(event) {
  mapPanel.classList.toggle("is-pinching", event.touches.length > 1);
}

mapElement.addEventListener("touchstart", updatePinchState, { passive: true });
mapElement.addEventListener("touchmove", updatePinchState, { passive: true });
mapElement.addEventListener("touchend", updatePinchState, { passive: true });
mapElement.addEventListener("touchcancel", () => mapPanel.classList.remove("is-pinching"), { passive: true });

// Newsletter sign-up pop-up. Shows on every visit, shortly after the page loads.
// Only people who have already signed up on this device stop seeing it.
function applyFavourites(types, regions) {
  state.types = new Set(types.filter((type) => type === "Vibe Approved" || state.events.some((event) => event.type.includes(type))));
  state.regions = new Set(regions.filter((region) => state.events.some((event) => event.region === region)));
  populateFilters();
  render();
}

// Used by account.js (profiles, preferences, saved-event sync).
window.VibeApp = {
  native,
  hooks,
  state,
  eventKey,
  findEvent,
  savedEvents,
  persistSaved,
  render,
  showToast,
  openEventDetail,
  closeEventDetail,
  applyFavourites,
  map,
  safeText,
  safeUrl,
  colorFor,
  todayString,
  formatFilterDate,
  formatFullDate,
  placeholderFlyer,
  placeLine,
  iconSvg,
  stripEmoji,
  isSaved,
  toggleSaved,
  setupRailDragScroll,
  eventTypes: () => [...new Set(state.events.flatMap((event) => event.type))].sort(),
  regions: () => ["North London", "North West London", "East London", "South London", "West London", "Central London"]
    .filter((region) => state.events.some((event) => event.region === region))
    .concat([...new Set(state.events.map((event) => event.region))].filter((region) =>
      region && !["North London", "North West London", "East London", "South London", "West London", "Central London"].includes(region)).sort()),
  ready: null,
};

async function start() {
  const stored = await native.storage.get(SAVED_KEY);
  if (Array.isArray(stored)) state.saved = new Map(stored);
  updateToolButtons();
  native.onReminderTap((key) => openEventFromLink(key));
  await loadEvents();
  document.dispatchEvent(new CustomEvent("vibe:events-loaded"));
  const linked = new URLSearchParams(location.search).get("event");
  if (linked) openEventFromLink(linked);
}

window.VibeApp.ready = start();
