const LONDON_CENTER = [51.485, -0.085];
const TYPE_COLORS = {
  "Day Party": "#d7f25a",
  "Night Party": "#e86d4e",
  Festival: "#74a7c2",
  "Sports Event": "#caaa71",
  Other: "#ece9dd",
};

const state = {
  events: [],
  markers: new Map(),
  date: "all",
  type: "all",
  age: "all",
  selectedId: null,
};

const elements = {
  ageFilter: document.querySelector("#ageFilter"),
  clearFilters: document.querySelector("#clearFilters"),
  closeRail: document.querySelector("#closeRail"),
  dateFilter: document.querySelector("#dateFilter"),
  emptyReset: document.querySelector("#emptyReset"),
  emptyState: document.querySelector("#emptyState"),
  eventList: document.querySelector("#eventList"),
  eventRail: document.querySelector("#eventRail"),
  lastUpdated: document.querySelector("#lastUpdated"),
  mapKey: document.querySelector("#mapKey"),
  mobileCount: document.querySelector("#mobileCount"),
  mobileListButton: document.querySelector("#mobileListButton"),
  refreshButton: document.querySelector("#refreshButton"),
  resultCount: document.querySelector("#resultCount"),
  syncStatus: document.querySelector("#syncStatus"),
  typeFilter: document.querySelector("#typeFilter"),
  visibleCount: document.querySelector("#visibleCount"),
};

const map = L.map("map", {
  zoomControl: false,
  scrollWheelZoom: true,
  touchZoom: "center",
  bounceAtZoomLimits: false,
  attributionControl: true,
}).setView(LONDON_CENTER, 11);

L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
  maxZoom: 20,
  subdomains: "abcd",
}).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  subdomains: "abcd",
  pane: "shadowPane",
}).addTo(map);

function safeText(value = "") {
  const node = document.createElement("div");
  node.textContent = value;
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
  return TYPE_COLORS[type] || TYPE_COLORS.Other;
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

function filteredEvents() {
  return state.events.filter((event) =>
    (state.date === "all" || event.date === state.date)
    && (state.type === "all" || event.type === state.type)
    && (state.age === "all" || event.ageRange === state.age),
  );
}

function markerIcon(event, index) {
  return L.divIcon({
    className: "event-marker-wrap",
    html: `<div class="event-marker" style="--marker-color:${colorFor(event.type)}"><span>${String(index + 1).padStart(2, "0")}</span></div>`,
    iconSize: [30, 34],
    iconAnchor: [13, 30],
    popupAnchor: [0, -30],
  });
}

function popupMarkup(event) {
  const ticketUrl = safeUrl(event.ticketUrl);
  return `<article class="popup-card" style="--event-color:${colorFor(event.type)}">
    <p class="popup-label">${safeText(event.type)} / ${safeText(formatFullDate(event.date))}</p>
    <h2>${safeText(event.title)}</h2>
    <p class="popup-meta">${safeText(event.location)}</p>
    <div class="popup-facts"><span>${safeText(event.ageRange)}</span><span>From ${safeText(event.price)}</span></div>
    ${ticketUrl ? `<a class="popup-link" href="${ticketUrl}" target="_blank" rel="noopener noreferrer"><span>Get tickets</span><span>↗</span></a>` : ""}
  </article>`;
}

function renderMap(events) {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  events.forEach((event, index) => {
    const marker = L.marker([event.latitude, event.longitude], {
      icon: markerIcon(event, index),
      title: event.title,
      riseOnHover: true,
    }).addTo(map);

    marker.bindPopup(popupMarkup(event), { closeButton: true, maxWidth: 280, offset: [0, -2] });
    marker.on("click", () => selectEvent(event.id, false));
    marker.on("popupclose", () => clearSelection());
    state.markers.set(event.id, marker);
  });

  if (events.length === 1) map.setView([events[0].latitude, events[0].longitude], 14, { animate: true });
  if (events.length > 1) {
    const bounds = L.latLngBounds(events.map((event) => [event.latitude, event.longitude]));
    map.fitBounds(bounds, { padding: [55, 55], maxZoom: 12, animate: true });
  }
}

function renderCards(events) {
  elements.eventList.innerHTML = events.map((event, index) => {
    const parts = dateParts(event.date);
    return `<button class="event-card ${state.selectedId === event.id ? "active" : ""}" data-event-id="${safeText(event.id)}" type="button" style="--event-color:${colorFor(event.type)};animation-delay:${index * 45}ms">
      <span class="card-date">${parts.day}<small>${parts.month}</small></span>
      <span>
        <span class="card-type">${safeText(event.type)}</span>
        <h2>${safeText(event.title)}</h2>
        <span class="card-location">${safeText(event.location)}</span>
        <span class="card-bottom"><span>${safeText(event.ageRange)}</span><span>From ${safeText(event.price)} ↗</span></span>
      </span>
    </button>`;
  }).join("");

  elements.eventList.querySelectorAll(".event-card").forEach((card) => {
    card.addEventListener("click", () => selectEvent(card.dataset.eventId, true));
  });
}

function renderKey(events) {
  const types = [...new Set(events.map((event) => event.type))];
  elements.mapKey.innerHTML = types.map((type) =>
    `<span class="key-item"><span class="key-dot" style="background:${colorFor(type)}"></span>${safeText(type)}</span>`,
  ).join("");
}

function render() {
  const events = filteredEvents();
  if (!events.some((event) => event.id === state.selectedId)) state.selectedId = null;

  renderMap(events);
  renderCards(events);
  renderKey(events);

  const countLabel = `${events.length} ${events.length === 1 ? "location" : "locations"}`;
  elements.resultCount.textContent = events.length;
  elements.mobileCount.textContent = events.length;
  elements.visibleCount.textContent = countLabel;
  elements.emptyState.hidden = events.length !== 0;
  document.querySelector(".map-section").hidden = events.length === 0;
}

function selectEvent(id, openPopup) {
  state.selectedId = id;
  document.querySelectorAll(".event-card").forEach((card) => card.classList.toggle("active", card.dataset.eventId === id));
  state.markers.forEach((marker, markerId) => marker.getElement()?.classList.toggle("is-active", markerId === id));

  const marker = state.markers.get(id);
  if (marker) {
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 13), { duration: 0.65 });
    if (openPopup) marker.openPopup();
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

function populateFilters() {
  const dates = [...new Set(state.events.map((event) => event.date))].sort();
  const types = [...new Set(state.events.map((event) => event.type))].sort();
  const ages = [...new Set(state.events.map((event) => event.ageRange))].sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
  populateSelect(elements.dateFilter, dates, formatFilterDate);
  populateSelect(elements.typeFilter, types);
  populateSelect(elements.ageFilter, ages);
}

function resetFilters() {
  state.date = "all";
  state.type = "all";
  state.age = "all";
  elements.dateFilter.value = "all";
  elements.typeFilter.value = "all";
  elements.ageFilter.value = "all";
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
    const response = await fetch("/api/events", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load events");

    state.events = Array.isArray(payload.events) ? payload.events : [];
    populateFilters();
    render();
    elements.syncStatus.lastElementChild.textContent = `${state.events.length} events live on the map`;
    elements.lastUpdated.textContent = `Sheet checked ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(payload.updatedAt))}`;
  } catch (error) {
    elements.syncStatus.classList.add("error");
    elements.syncStatus.lastElementChild.textContent = error.message || "The event feed is offline";
    elements.lastUpdated.textContent = "Unable to reach the event sheet";
  } finally {
    setLoading(false);
  }
}

elements.dateFilter.addEventListener("change", (event) => { state.date = event.target.value; render(); });
elements.typeFilter.addEventListener("change", (event) => { state.type = event.target.value; render(); });
elements.ageFilter.addEventListener("change", (event) => { state.age = event.target.value; render(); });
elements.clearFilters.addEventListener("click", resetFilters);
elements.emptyReset.addEventListener("click", resetFilters);
elements.refreshButton.addEventListener("click", loadEvents);
elements.mobileListButton.addEventListener("click", openMobileRail);
elements.closeRail.addEventListener("click", closeMobileRail);

const mapPanel = document.querySelector(".map-panel");
const mapElement = document.querySelector("#map");

function updatePinchState(event) {
  mapPanel.classList.toggle("is-pinching", event.touches.length > 1);
}

mapElement.addEventListener("touchstart", updatePinchState, { passive: true });
mapElement.addEventListener("touchmove", updatePinchState, { passive: true });
mapElement.addEventListener("touchend", updatePinchState, { passive: true });
mapElement.addEventListener("touchcancel", () => mapPanel.classList.remove("is-pinching"), { passive: true });

loadEvents();
