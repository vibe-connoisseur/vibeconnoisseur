const LONDON_CENTER = [51.485, -0.085];
const TYPE_COLORS = {
  "Day Party": "#d7f25a",
  "Night Party": "#e86d4e",
  Festival: "#74a7c2",
  "Sports Event": "#caaa71",
  Concert: "#e58eaa",
  "LGBTQ+": "#ece9dd",
  Brunch: "#a35ee5",
  "Networking Events": "#8b1a2b",
  "Games Nights": "#6b4226",
  Other: "#ece9dd",
};

const state = {
  events: [],
  markers: new Map(),
  date: "all",
  types: new Set(),
  age: "all",
  regions: new Set(),
  search: "",
  selectedId: null,
};

const elements = {
  ageFilter: document.querySelector("#ageFilter"),
  clearFilters: document.querySelector("#clearFilters"),
  closeRail: document.querySelector("#closeRail"),
  concertRail: document.querySelector("#concertRail"),
  concertScrubber: document.querySelector("#concertScrubber"),
  concertShowcase: document.querySelector("#concertShowcase"),
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
  searchInput: document.querySelector("#searchInput"),
  syncStatus: document.querySelector("#syncStatus"),
  typeToggle: document.querySelector("#typeFilterToggle"),
  typePanel: document.querySelector("#typeFilterPanel"),
  vibeApprovedRail: document.querySelector("#vibeApprovedRail"),
  vibeApprovedScrubber: document.querySelector("#vibeApprovedScrubber"),
  vibeApprovedShowcase: document.querySelector("#vibeApprovedShowcase"),
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
  return `<article class="popup-card ${event.vibeApproved ? "approved" : ""}" style="--event-color:${colorFor(event.type[0])}">
    ${event.vibeApproved ? '<img class="popup-approved" src="assets/vibe-approved.png" alt="Vibe approved" />' : ""}
    <p class="popup-label">${safeText(typeLabel)} / ${safeText(formatFullDate(event.date))}</p>
    <h2>${safeText(event.title)}</h2>
    <p class="popup-meta">${safeText(event.location)}</p>
    <div class="popup-facts"><span>${safeText(event.region)}</span><span>${safeText(event.ageRange)}</span><span>From ${safeText(event.price)}</span></div>
    ${event.tags?.length ? `<div class="popup-tags">${event.tags.map((tag) => `<span>${safeText(tag)}</span>`).join("")}</div>` : ""}
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
        ${event.tags?.length ? `<span class="card-tags">${event.tags.map((tag) => `<span>${safeText(tag)}</span>`).join("")}</span>` : ""}
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

function flyerCardMarkup(event) {
  const ticketUrl = safeUrl(event.ticketUrl);
  const flyerUrl = safeUrl(event.flyerUrl);
  const typeLabel = event.type.join(" / ");
  return `<a class="flyer-card ${flyerUrl ? "" : "no-flyer"}" style="--event-color:${colorFor(event.type[0])}" href="${ticketUrl || "#"}" target="${ticketUrl ? "_blank" : "_self"}" rel="noopener noreferrer" draggable="false">
    <span class="flyer-card-image" ${flyerUrl ? `style="background-image:url('${flyerUrl}')"` : ""} aria-hidden="true">
      ${event.vibeApproved ? '<img class="flyer-card-approved" src="assets/vibe-approved.png" alt="Vibe approved" draggable="false" />' : ""}
    </span>
    <span class="flyer-card-body">
      <span class="flyer-card-type">${safeText(typeLabel)} / ${safeText(formatFilterDate(event.date))}</span>
      <h3>${safeText(event.title)}</h3>
      <span class="flyer-card-location">${safeText(event.location)}</span>
      <span class="flyer-card-meta"><span>${safeText(event.region)}</span><span>${safeText(event.ageRange)}</span><span>From ${safeText(event.price)}</span></span>
      ${event.tags?.length ? `<span class="flyer-card-tags">${event.tags.map((tag) => `<span>${safeText(tag)}</span>`).join("")}</span>` : ""}
    </span>
  </a>`;
}

function renderFlyerShowcases() {
  const vibeApprovedEvents = state.events.filter((event) => event.vibeApproved);
  const concertEvents = state.events.filter((event) => event.type.includes("Concert"));

  elements.vibeApprovedShowcase.hidden = vibeApprovedEvents.length === 0;
  elements.vibeApprovedRail.innerHTML = vibeApprovedEvents.map(flyerCardMarkup).join("");
  syncRailScrubber(elements.vibeApprovedRail, elements.vibeApprovedScrubber);

  elements.concertShowcase.hidden = concertEvents.length === 0;
  elements.concertRail.innerHTML = concertEvents.map(flyerCardMarkup).join("");
  syncRailScrubber(elements.concertRail, elements.concertScrubber);
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

setupRailDragScroll(elements.vibeApprovedRail);
setupRailDragScroll(elements.concertRail);
bindRailScrubber(elements.vibeApprovedRail, elements.vibeApprovedScrubber);
bindRailScrubber(elements.concertRail, elements.concertScrubber);

function render() {
  const events = filteredEvents();
  if (!events.some((event) => event.id === state.selectedId)) state.selectedId = null;

  renderMap(events);
  renderCards(events);
  renderKey(events);

  elements.resultCount.textContent = events.length;
  elements.mobileCount.textContent = events.length;
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
    const response = await fetch("/api/events", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load events");

    state.events = Array.isArray(payload.events) ? payload.events : [];
    populateFilters();
    renderFlyerShowcases();
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
elements.searchInput.addEventListener("input", (event) => { state.search = event.target.value; render(); });
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
