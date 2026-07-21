const LONDON_CENTER = [51.485, -0.085];
const TYPE_COLORS = {
  "Day Party": "#d7f25a",
  "Night Party": "#e86d4e",
  Festival: "#74a7c2",
  "Sports Event": "#caaa71",
  Concert: "#e58eaa",
  "LGBTQ+": "#ece9dd",
  Brunch: "#a35ee5",
  "Networking Event": "#8b1a2b",
  "Games Night": "#6b4226",
  Other: "#ece9dd",
};

const state = {
  events: [],
  markers: new Map(),
  date: "all",
  types: new Set(),
  age: "all",
  regions: new Set(),
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
  locationToggle: document.querySelector("#locationFilterToggle"),
  locationPanel: document.querySelector("#locationFilterPanel"),
  mapKey: document.querySelector("#mapKey"),
  mobileCount: document.querySelector("#mobileCount"),
  mobileListButton: document.querySelector("#mobileListButton"),
  refreshButton: document.querySelector("#refreshButton"),
  resultCount: document.querySelector("#resultCount"),
  syncStatus: document.querySelector("#syncStatus"),
  typeToggle: document.querySelector("#typeFilterToggle"),
  typePanel: document.querySelector("#typeFilterPanel"),
  visibleCount: document.querySelector("#visibleCount"),
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

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function filteredEvents() {
  return state.events.filter((event) => {
    const matchesDate = state.date === "all" || event.date === state.date;
    const matchesAge = state.age === "all" || event.ageRange === state.age;
    const matchesType =
      state.types.size === 0
      || event.type.some((type) => state.types.has(type))
      || (state.types.has("Vibe Approved") && event.vibeApproved);
    const matchesRegion = state.regions.size === 0 || state.regions.has(event.region);
    return matchesDate && matchesAge && matchesType && matchesRegion;
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
  return `<article class="popup-card ${event.vibeApproved ? "approved" : ""}" style="--event-color:${colorFor(event.type[0])}">
    ${event.vibeApproved ? '<img class="popup-approved" src="assets/vibe-approved.png" alt="Vibe approved" />' : ""}
    <p class="popup-label">${safeText(typeLabel)} / ${safeText(formatFullDate(event.date))}</p>
    <h2>${safeText(event.title)}</h2>
    <p class="popup-meta">${safeText(event.location)}</p>
    <div class="popup-facts"><span>${safeText(event.region)}</span><span>${safeText(event.ageRange)}</span><span>From ${safeText(event.price)}</span></div>
    ${event.genres?.length ? `<div class="popup-genres">${event.genres.map((genre) => `<span>${safeText(genre)}</span>`).join("")}</div>` : ""}
    ${ticketUrl ? `<a class="popup-link" href="${ticketUrl}" target="_blank" rel="noopener noreferrer"><span>Get tickets</span><span>↗</span></a>` : ""}
  </article>`;
}

function renderMap(events) {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  events.forEach((event) => {
    const marker = L.marker([event.latitude, event.longitude], {
      icon: markerIcon(event),
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
    const typeLabel = event.type.join(" / ");
    return `<button class="event-card ${state.selectedId === event.id ? "active" : ""}" data-event-id="${safeText(event.id)}" type="button" style="--event-color:${colorFor(event.type[0])};animation-delay:${index * 45}ms">
      <span class="card-date">${parts.day}<small>${parts.month}</small></span>
      <span>
        <span class="card-type">${safeText(typeLabel)}${event.vibeApproved ? '<img class="card-approved" src="assets/vibe-approved.png" alt="Vibe approved" />' : ""}</span>
        <h2>${safeText(event.title)}</h2>
        <span class="card-location">${safeText(event.location)}</span>
        ${event.genres?.length ? `<span class="card-genres">${event.genres.map((genre) => safeText(genre)).join(" · ")}</span>` : ""}
        <span class="card-bottom"><span>${safeText(event.region)} · ${safeText(event.ageRange)}</span><span>From ${safeText(event.price)} ↗</span></span>
      </span>
    </button>`;
  }).join("");

  elements.eventList.querySelectorAll(".event-card").forEach((card) => {
    card.addEventListener("click", () => selectEvent(card.dataset.eventId, true));
  });
}

function renderKey(events) {
  const types = [...new Set(events.flatMap((event) => event.type))];
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
  const regionOrder = ["East London", "South London", "West London", "North West London"];
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
  elements.dateFilter.value = "all";
  elements.ageFilter.value = "all";
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
    const response = await fetch("/api/events", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load events");

    state.events = Array.isArray(payload.events) ? payload.events : [];
    populateFilters();
    render();
    elements.syncStatus.lastElementChild.textContent = `${state.events.length} events live on the map`;
  } catch (error) {
    elements.syncStatus.classList.add("error");
    elements.syncStatus.lastElementChild.textContent = error.message || "The event feed is offline";
  } finally {
    setLoading(false);
  }
}

elements.dateFilter.addEventListener("change", (event) => { state.date = event.target.value; render(); });
elements.ageFilter.addEventListener("change", (event) => { state.age = event.target.value; render(); });
elements.clearFilters.addEventListener("click", resetFilters);
elements.emptyReset.addEventListener("click", resetFilters);
elements.refreshButton.addEventListener("click", loadEvents);
elements.mobileListButton.addEventListener("click", openMobileRail);
elements.closeRail.addEventListener("click", closeMobileRail);
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

loadEvents();
