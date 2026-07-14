const LONDON_CENTER = [51.5072, -0.1276];
const EVENT_COLORS = ["#c9e769", "#c96e4a", "#8db7a5", "#d1b06a", "#a99bc7"];

const state = { events: [], category: "all", markers: [] };
const map = L.map("map", { zoomControl: false, scrollWheelZoom: true }).setView(LONDON_CENTER, 12);

L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  maxZoom: 20,
}).addTo(map);

const elements = {
  categoryFilters: document.querySelector("#categoryFilters"),
  emptyState: document.querySelector("#emptyState"),
  eventList: document.querySelector("#eventList"),
  eventRail: document.querySelector(".event-rail"),
  lastUpdated: document.querySelector("#lastUpdated"),
  listToggle: document.querySelector("#listToggle"),
  mobileResultCount: document.querySelector("#mobileResultCount"),
  refreshButton: document.querySelector("#refreshButton"),
  resultCount: document.querySelector("#resultCount"),
  syncStatus: document.querySelector("#syncStatus"),
};

function safeText(value = "") {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function safeUrl(value = "") {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function filteredEvents() {
  return state.category === "all"
    ? state.events
    : state.events.filter((event) => event.category === state.category);
}

function eventColor(event) {
  const categories = [...new Set(state.events.map((item) => item.category))];
  return EVENT_COLORS[Math.max(0, categories.indexOf(event.category)) % EVENT_COLORS.length];
}

function popupMarkup(event) {
  const ticketUrl = safeUrl(event.ticketUrl);
  return `<div class="popup-inner">
    <p class="popup-kicker">${safeText(event.category)} · ${safeText(event.ageRange || "All ages")}</p>
    <h2>${safeText(event.title)}</h2>
    <p class="popup-meta">${safeText(event.venue)}<br>${safeText(event.location)}</p>
    ${ticketUrl ? `<a class="popup-link" href="${ticketUrl}" target="_blank" rel="noopener noreferrer">Tickets from ${safeText(event.price || "venue")} ↗</a>` : ""}
  </div>`;
}

function renderFilters() {
  const categories = [...new Set(state.events.map((event) => event.category))].sort();
  elements.categoryFilters.innerHTML = ["all", ...categories].map((category) => {
    const label = category === "all" ? "Everything" : category;
    return `<button class="filter ${state.category === category ? "active" : ""}" data-category="${safeText(category)}" type="button">${safeText(label)}</button>`;
  }).join("");
}

function render() {
  const events = filteredEvents();
  state.markers.forEach(({ marker }) => marker.remove());
  state.markers = [];
  elements.resultCount.textContent = String(events.length).padStart(2, "0");
  elements.mobileResultCount.textContent = String(events.length).padStart(2, "0");
  elements.emptyState.hidden = events.length > 0;

  elements.eventList.innerHTML = events.map((event, index) => {
    const color = eventColor(event);
    return `<button class="event-card" data-event-id="${safeText(event.id)}" type="button" style="--event-color:${color}">
      <p class="card-number">${String(index + 1).padStart(2, "0")} / ${String(events.length).padStart(2, "0")}</p>
      <h2>${safeText(event.title)}</h2>
      <p class="card-meta">${safeText(event.venue)}<br>${safeText(event.location)}</p>
      <div class="card-footer">
        <span class="card-tag">${safeText(event.category)} · ${safeText(event.ageRange || "All ages")}</span>
        <span class="card-price">${safeText(event.price || "Info")}</span>
      </div>
    </button>`;
  }).join("");

  events.forEach((event, index) => {
    const color = eventColor(event);
    const icon = L.divIcon({
      className: "event-pin-wrap",
      html: `<div class="event-pin" style="--pin-color:${color}"><span>${String(index + 1).padStart(2, "0")}</span></div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
      popupAnchor: [0, -17],
    });
    const marker = L.marker([event.latitude, event.longitude], { icon }).addTo(map).bindPopup(popupMarkup(event));
    marker.on("click", () => setActiveCard(event.id));
    state.markers.push({ id: event.id, marker });
  });

  if (events.length > 1) {
    map.fitBounds(L.latLngBounds(events.map((event) => [event.latitude, event.longitude])), { padding: [100, 100], maxZoom: 14 });
  } else if (events.length === 1) {
    map.flyTo([events[0].latitude, events[0].longitude], 14, { duration: .9 });
  }
}

function setActiveCard(eventId) {
  document.querySelectorAll(".event-card").forEach((card) => card.classList.toggle("active", card.dataset.eventId === eventId));
}

async function loadEvents() {
  elements.refreshButton.classList.add("loading");
  elements.syncStatus.textContent = "Reading the guest list...";
  try {
    const response = await fetch("/api/events", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The event feed is unavailable.");
    state.events = data.events || [];
    renderFilters();
    render();
    elements.syncStatus.textContent = state.events.length ? "Sheet connected · pins live" : "Sheet connected · no events found";
    elements.lastUpdated.textContent = `Updated ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(data.updatedAt))}`;
  } catch (error) {
    elements.syncStatus.textContent = error.message;
    elements.lastUpdated.textContent = "Connection paused";
  } finally {
    elements.refreshButton.classList.remove("loading");
  }
}

elements.categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  renderFilters();
  render();
});

elements.eventList.addEventListener("click", (event) => {
  const card = event.target.closest(".event-card");
  if (!card) return;
  const item = state.markers.find(({ id }) => id === card.dataset.eventId);
  if (!item) return;
  setActiveCard(item.id);
  elements.eventRail.classList.remove("open");
  elements.listToggle.setAttribute("aria-expanded", "false");
  map.flyTo(item.marker.getLatLng(), 15, { duration: .8 });
  window.setTimeout(() => item.marker.openPopup(), 650);
});

elements.listToggle.addEventListener("click", () => {
  const open = elements.eventRail.classList.toggle("open");
  elements.listToggle.setAttribute("aria-expanded", String(open));
});

document.querySelector("#resetFilters").addEventListener("click", () => {
  state.category = "all";
  renderFilters();
  render();
});

elements.refreshButton.addEventListener("click", loadEvents);
loadEvents();
window.setInterval(loadEvents, 5 * 60 * 1000);
