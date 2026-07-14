const LONDON_CENTER = [51.5072, -0.1276];
const CATEGORY_COLORS = {
  Art: "#ff5938",
  Music: "#d7f64a",
  Food: "#ff9d3b",
  Film: "#56b4f2",
  Culture: "#d68cff",
  Other: "#f2f0e7",
};

const state = { events: [], dateFilter: "all", category: "all", markers: [] };

const map = L.map("map", { zoomControl: false, scrollWheelZoom: true }).setView(LONDON_CENTER, 12);
L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  maxZoom: 20,
}).addTo(map);

const elements = {
  categoryFilters: document.querySelector("#categoryFilters"),
  currentDate: document.querySelector("#currentDate"),
  dateFilters: document.querySelector("#dateFilters"),
  emptyState: document.querySelector("#emptyState"),
  eventDrawer: document.querySelector("#eventDrawer"),
  eventList: document.querySelector("#eventList"),
  lastUpdated: document.querySelector("#lastUpdated"),
  listToggle: document.querySelector("#listToggle"),
  refreshButton: document.querySelector("#refreshButton"),
  resultCount: document.querySelector("#resultCount"),
  syncStatus: document.querySelector("#syncStatus"),
};

function londonDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateFromISO(value) {
  return new Date(`${value}T12:00:00Z`);
}

function formatEventDate(value) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(dateFromISO(value));
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(dateFromISO(value));
}

function weekendDates() {
  const today = dateFromISO(londonDateParts());
  const day = today.getUTCDay();
  const saturdayOffset = day === 0 ? -1 : 6 - day;
  const saturday = new Date(today);
  saturday.setUTCDate(today.getUTCDate() + saturdayOffset);
  const sunday = new Date(saturday);
  sunday.setUTCDate(saturday.getUTCDate() + 1);
  return [londonDateParts(saturday), londonDateParts(sunday)];
}

function safeText(value = "") {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function eventTime(event) {
  const range = event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime;
  return range || "Time TBC";
}

function filteredEvents() {
  const today = londonDateParts();
  const weekend = weekendDates();
  return state.events.filter((event) => {
    const dateMatch = state.dateFilter === "all"
      || (state.dateFilter === "today" && event.date === today)
      || (state.dateFilter === "weekend" && weekend.includes(event.date));
    const categoryMatch = state.category === "all" || event.category === state.category;
    return dateMatch && categoryMatch;
  });
}

function popupMarkup(event) {
  const image = safeUrl(event.imageUrl);
  const ticket = safeUrl(event.ticketUrl);
  return `
    ${image ? `<img class="popup-image" src="${image}" alt="" />` : ""}
    <div class="popup-body">
      <p class="popup-kicker">${safeText(event.category)} · ${safeText(event.price || "Details inside")}</p>
      <h2>${safeText(event.title)}</h2>
      <p class="popup-meta">${safeText(formatLongDate(event.date))} / ${safeText(eventTime(event))}<br>${safeText(event.venue)}${event.address ? ` · ${safeText(event.address)}` : ""}</p>
      ${event.description ? `<p class="popup-description">${safeText(event.description)}</p>` : ""}
      ${ticket ? `<a class="popup-link" href="${ticket}" target="_blank" rel="noopener noreferrer">View event ↗</a>` : ""}
    </div>`;
}

function renderCategories() {
  const categories = [...new Set(state.events.map((event) => event.category))].sort();
  elements.categoryFilters.innerHTML = ["all", ...categories].map((category) => {
    const label = category === "all" ? "Everything" : category;
    const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
    return `<button class="filter ${state.category === category ? "active" : ""}" data-category="${safeText(category)}" type="button"><span class="category-swatch" style="background:${color}"></span>${safeText(label)}</button>`;
  }).join("");
}

function renderMap() {
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];
  const events = filteredEvents();

  events.forEach((event) => {
    const color = CATEGORY_COLORS[event.category] || CATEGORY_COLORS.Other;
    const icon = L.divIcon({
      className: "vibe-marker",
      html: `<div class="marker-pin" style="background:${color}"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
      popupAnchor: [0, -22],
    });
    const marker = L.marker([event.latitude, event.longitude], { icon })
      .addTo(map)
      .bindPopup(popupMarkup(event), { maxWidth: 320 });
    marker.eventId = event.id;
    state.markers.push(marker);
  });

  elements.eventList.innerHTML = events.map((event) => `
    <button class="event-card" type="button" data-event-id="${safeText(event.id)}">
      <span class="event-card-date">${safeText(formatEventDate(event.date))}<br>${safeText(event.startTime || "TBC")}</span>
      <span><h3>${safeText(event.title)}</h3><p>${safeText(event.category)} / ${safeText(event.venue)}</p></span>
    </button>`).join("");

  elements.resultCount.textContent = events.length;
  elements.emptyState.hidden = events.length > 0;
  document.querySelector(".map-layout").hidden = events.length === 0;
}

function setStatus(message, type = "") {
  elements.syncStatus.className = `sync-status ${type}`.trim();
  elements.syncStatus.innerHTML = `<span class="status-dot"></span>${safeText(message)}`;
}

async function loadEvents() {
  elements.refreshButton.classList.add("loading");
  elements.refreshButton.disabled = true;
  setStatus("Reading the spreadsheet");
  try {
    const response = await fetch("/api/events", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load events");
    state.events = payload.events;
    renderCategories();
    renderMap();
    const updated = new Date(payload.updatedAt);
    setStatus(`${state.events.length} events synced`, "ready");
    elements.lastUpdated.textContent = `Sheet checked ${updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    setStatus(error.message, "error");
    elements.lastUpdated.textContent = "Spreadsheet connection needs attention";
    elements.emptyState.hidden = false;
    document.querySelector(".map-layout").hidden = true;
  } finally {
    elements.refreshButton.classList.remove("loading");
    elements.refreshButton.disabled = false;
  }
}

elements.dateFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date]");
  if (!button) return;
  state.dateFilter = button.dataset.date;
  elements.dateFilters.querySelectorAll(".filter").forEach((filter) => filter.classList.toggle("active", filter === button));
  renderMap();
});

elements.categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderCategories();
  renderMap();
});

elements.eventList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-event-id]");
  if (!card) return;
  const marker = state.markers.find((item) => item.eventId === card.dataset.eventId);
  if (marker) {
    elements.eventDrawer.classList.remove("open");
    map.flyTo(marker.getLatLng(), 15, { duration: .8 });
    window.setTimeout(() => marker.openPopup(), 700);
  }
});

elements.listToggle.addEventListener("click", () => {
  const open = elements.eventDrawer.classList.toggle("open");
  elements.listToggle.setAttribute("aria-expanded", String(open));
});
document.querySelector("#closeDrawer").addEventListener("click", () => elements.eventDrawer.classList.remove("open"));
elements.refreshButton.addEventListener("click", loadEvents);

elements.currentDate.textContent = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(new Date());
loadEvents();
window.setInterval(loadEvents, 5 * 60 * 1000);
