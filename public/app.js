// Tallinn Airport coordinates
const TLL = [59.4133, 24.8328];

// Map setup
const map = L.map("map", {
  center: [54, 20],
  zoom: 4,
  zoomControl: true,
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 18,
}).addTo(map);

// TLL marker (star / home)
const tllIcon = L.divIcon({
  html: `<div style="
    width:14px;height:14px;
    background:#f5c518;
    border:2px solid #fff;
    border-radius:50%;
    box-shadow:0 0 8px rgba(245,197,24,0.8);
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  className: "",
});

L.marker(TLL, { icon: tllIcon })
  .addTo(map)
  .bindTooltip("Tallinn (TLL)", { permanent: false });

// Destination marker
function makeDestIcon() {
  return L.divIcon({
    html: `<div style="
      width:10px;height:10px;
      background:#4a90d9;
      border:2px solid rgba(255,255,255,0.7);
      border-radius:50%;
    "></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    className: "",
  });
}

let routes = [];
let markers = {}; // iata → Leaflet marker
let lines = []; // Leaflet polylines
let activeItem = null;

async function init() {
  try {
    const res = await fetch("/api/routes");
    if (!res.ok) throw new Error("API error " + res.status);
    routes = await res.json();
    renderSidebar(routes);
    renderMap(routes);
    document.getElementById("dest-count").textContent =
      routes.length + " sihtkohta";
  } catch (err) {
    document.getElementById("dest-count").textContent = "Viga andmete laadimisel";
    console.error(err);
  }
}

function renderMap(routeList) {
  // Clear previous
  lines.forEach((l) => map.removeLayer(l));
  lines = [];
  Object.values(markers).forEach((m) => map.removeLayer(m));
  markers = {};

  for (const r of routeList) {
    const destLatLng = [r.lat, r.lon];

    // Gray line TLL → destination
    const line = L.polyline([TLL, destLatLng], {
      color: "#3a4060",
      weight: 1.5,
      opacity: 0.7,
    }).addTo(map);
    lines.push(line);

    // Destination marker
    const marker = L.marker(destLatLng, { icon: makeDestIcon() }).addTo(map);
    marker.bindPopup(popupHtml(r));
    markers[r.iata] = marker;
  }
}

function popupHtml(r) {
  return `
    <div class="popup-city">${r.city} <span class="popup-iata">${r.iata}</span></div>
    <div class="popup-country">${r.country}</div>
    <div class="popup-airlines">${r.airlines.join(", ")}</div>
  `;
}

function renderSidebar(routeList) {
  const list = document.getElementById("dest-list");
  list.innerHTML = "";

  // Group by country
  const byCountry = {};
  for (const r of routeList) {
    if (!byCountry[r.country]) byCountry[r.country] = [];
    byCountry[r.country].push(r);
  }

  const countries = Object.keys(byCountry).sort();

  for (const country of countries) {
    const group = document.createElement("div");
    group.className = "country-group";

    const label = document.createElement("div");
    label.className = "country-label";
    label.textContent = country;
    group.appendChild(label);

    for (const r of byCountry[country]) {
      const item = document.createElement("div");
      item.className = "dest-item";
      item.dataset.iata = r.iata;
      item.innerHTML = `
        <div class="dest-city">${r.city}</div>
        <div class="dest-airlines">${r.airlines.join(", ")}</div>
      `;
      item.addEventListener("click", () => selectDest(r, item));
      group.appendChild(item);
    }

    list.appendChild(group);
  }
}

function selectDest(r, itemEl) {
  if (activeItem) activeItem.classList.remove("active");
  activeItem = itemEl;
  itemEl.classList.add("active");

  const marker = markers[r.iata];
  if (marker) {
    map.setView([r.lat, r.lon], 7, { animate: true });
    marker.openPopup();
  }
}

// Search
document.getElementById("search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderSidebar(routes);
    renderMap(routes);
    document.getElementById("dest-count").textContent =
      routes.length + " sihtkohta";
    return;
  }
  const filtered = routes.filter(
    (r) =>
      r.city.toLowerCase().includes(q) ||
      r.country.toLowerCase().includes(q) ||
      r.airlines.some((a) => a.toLowerCase().includes(q)) ||
      r.iata.toLowerCase().includes(q)
  );
  renderSidebar(filtered);
  renderMap(filtered);
  document.getElementById("dest-count").textContent =
    filtered.length + " sihtkohta";
});

init();
