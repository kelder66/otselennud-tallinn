// Tallinn Airport coordinates
const TLL = [59.4133, 24.8328];
const DEP_COLOR = "#4a90d9"; // blue  — Tallinnast
const ARR_COLOR = "#e8832a"; // orange — Tallinna
const LINE_OFFSET = 0.25;   // degrees perpendicular offset when both directions overlap

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

// TLL marker
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

// Map legend (Leaflet control)
const legend = L.control({ position: "bottomright" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "map-legend");
  div.innerHTML = `
    <div class="legend-item">
      <span class="legend-dot" style="background:${DEP_COLOR}"></span> Tallinnast
    </div>
    <div class="legend-item">
      <span class="legend-dot" style="background:${ARR_COLOR}"></span> Tallinna
    </div>
  `;
  return div;
};
legend.addTo(map);

function makeDestIcon(hasDep, hasArr) {
  if (hasDep && hasArr) {
    return L.divIcon({
      html: `<div style="
        width:12px;height:12px;
        border:2px solid rgba(255,255,255,0.7);
        border-radius:50%;overflow:hidden;display:flex;
      "><div style="flex:1;background:${DEP_COLOR}"></div><div style="flex:1;background:${ARR_COLOR}"></div></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      className: "",
    });
  }
  const color = hasDep ? DEP_COLOR : ARR_COLOR;
  return L.divIcon({
    html: `<div style="
      width:10px;height:10px;
      background:${color};
      border:2px solid rgba(255,255,255,0.7);
      border-radius:50%;
    "></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    className: "",
  });
}

// --- State ---
let departureRoutes = [];
let arrivalRoutes = [];
let markers = {};
let lines = [];
let activeItem = null;
let showDep = true;
let showArr = true;

// --- Date helpers ---
function toDateStr(d) {
  return d.toISOString().split("T")[0];
}

function initDateDefaults() {
  const today = new Date();
  const future = new Date(today);
  future.setMonth(today.getMonth() + 3);
  document.getElementById("from-date").value = toDateStr(today);
  document.getElementById("to-date").value = toDateStr(future);
}

// --- Data loading ---
async function loadRoutes() {
  const from = document.getElementById("from-date").value;
  const to   = document.getElementById("to-date").value;

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to)   params.set("to", to);

  document.getElementById("dest-count").textContent = "laadimine...";

  try {
    const [depRes, arrRes] = await Promise.all([
      fetch("/api/routes?direction=departure&" + params),
      fetch("/api/routes?direction=arrival&" + params),
    ]);
    if (!depRes.ok || !arrRes.ok) throw new Error("API error");
    [departureRoutes, arrivalRoutes] = await Promise.all([depRes.json(), arrRes.json()]);
    applyFilters();
  } catch (err) {
    document.getElementById("dest-count").textContent = "Viga andmete laadimisel";
    console.error(err);
  }
}

// --- Filter helpers ---
function filterBySearch(routes, q) {
  if (!q) return routes;
  return routes.filter(
    (r) =>
      r.city.toLowerCase().includes(q) ||
      r.country.toLowerCase().includes(q) ||
      r.airlines.some((a) => a.toLowerCase().includes(q)) ||
      r.iata.toLowerCase().includes(q)
  );
}

function applyFilters() {
  const q = document.getElementById("search").value.toLowerCase().trim();
  const filteredDep = showDep ? filterBySearch(departureRoutes, q) : [];
  const filteredArr = showArr ? filterBySearch(arrivalRoutes, q) : [];

  renderSidebar(filteredDep, filteredArr);
  renderMap(filteredDep, filteredArr);

  const uniqueIatas = new Set([
    ...filteredDep.map((r) => r.iata),
    ...filteredArr.map((r) => r.iata),
  ]);
  document.getElementById("dest-count").textContent = uniqueIatas.size + " sihtkohta";
}

// --- Perpendicular line offset ---
// Shifts a line segment by `dist` degrees perpendicular to its direction.
// Positive dist = left side, negative = right side.
function offsetPoints(from, to, dist) {
  const dlat = to[0] - from[0];
  const dlon = to[1] - from[1];
  const len = Math.sqrt(dlat * dlat + dlon * dlon);
  if (len < 0.0001) return [from, to];
  const perpLat = (-dlon / len) * dist;
  const perpLon = (dlat / len) * dist;
  return [
    [from[0] + perpLat, from[1] + perpLon],
    [to[0] + perpLat, to[1] + perpLon],
  ];
}

// --- Render ---
function renderMap(depRoutes, arrRoutes) {
  lines.forEach((l) => map.removeLayer(l));
  lines = [];
  Object.values(markers).forEach((m) => map.removeLayer(m));
  markers = {};

  const depMap = new Map(depRoutes.map((r) => [r.iata, r]));
  const arrMap = new Map(arrRoutes.map((r) => [r.iata, r]));

  // Departure lines (blue, offset left when overlap)
  for (const r of depRoutes) {
    const dest = [r.lat, r.lon];
    const pts = arrMap.has(r.iata) ? offsetPoints(TLL, dest, LINE_OFFSET) : [TLL, dest];
    lines.push(
      L.polyline(pts, { color: DEP_COLOR, weight: 1.5, opacity: 0.7 }).addTo(map)
    );
  }

  // Arrival lines (orange, offset right when overlap)
  for (const r of arrRoutes) {
    const dest = [r.lat, r.lon];
    const pts = depMap.has(r.iata) ? offsetPoints(TLL, dest, -LINE_OFFSET) : [TLL, dest];
    lines.push(
      L.polyline(pts, { color: ARR_COLOR, weight: 1.5, opacity: 0.7 }).addTo(map)
    );
  }

  // One marker per unique IATA (split-color when both directions)
  for (const iata of new Set([...depMap.keys(), ...arrMap.keys()])) {
    const dep = depMap.get(iata);
    const arr = arrMap.get(iata);
    const r = dep ?? arr;
    const marker = L.marker([r.lat, r.lon], { icon: makeDestIcon(!!dep, !!arr) }).addTo(map);
    marker.bindPopup(popupHtml(dep, arr));
    markers[iata] = marker;
  }
}

function popupHtml(dep, arr) {
  const r = dep ?? arr;
  let html = `
    <div class="popup-city">${r.city} <span class="popup-iata">${r.iata}</span></div>
    <div class="popup-country">${r.country}</div>
  `;
  if (dep) {
    html += `<div class="popup-dir-label dep-label">↗ Tallinnast &middot; ${dep.airlines.join(", ")}</div>`;
    if (dep.departures.length)
      html += `<div class="popup-dates">${dep.departures.join(", ")}</div>`;
  }
  if (arr) {
    html += `<div class="popup-dir-label arr-label">↙ Tallinna &middot; ${arr.airlines.join(", ")}</div>`;
    if (arr.departures.length)
      html += `<div class="popup-dates">${arr.departures.join(", ")}</div>`;
  }
  return html;
}

function renderSidebar(depRoutes, arrRoutes) {
  const list = document.getElementById("dest-list");
  list.innerHTML = "";

  const depMap = new Map(depRoutes.map((r) => [r.iata, r]));
  const arrMap = new Map(arrRoutes.map((r) => [r.iata, r]));
  const allIatas = [...new Set([...depMap.keys(), ...arrMap.keys()])];

  const merged = allIatas
    .map((iata) => ({
      r: depMap.get(iata) ?? arrMap.get(iata),
      hasDep: depMap.has(iata),
      hasArr: arrMap.has(iata),
    }))
    .sort((a, b) => a.r.city.localeCompare(b.r.city));

  const byCountry = {};
  for (const item of merged) {
    const c = item.r.country;
    if (!byCountry[c]) byCountry[c] = [];
    byCountry[c].push(item);
  }

  for (const country of Object.keys(byCountry).sort()) {
    const group = document.createElement("div");
    group.className = "country-group";

    const label = document.createElement("div");
    label.className = "country-label";
    label.textContent = country;
    group.appendChild(label);

    for (const { r, hasDep, hasArr } of byCountry[country]) {
      const item = document.createElement("div");
      item.className = "dest-item";
      item.dataset.iata = r.iata;

      const badges =
        (hasDep ? `<span class="dir-badge dep-badge">↗</span>` : "") +
        (hasArr ? `<span class="dir-badge arr-badge">↙</span>` : "");

      const dep = depMap.get(r.iata);
      const arr = arrMap.get(r.iata);
      const airlines = [
        ...new Set([...(dep?.airlines ?? []), ...(arr?.airlines ?? [])]),
      ].join(", ");

      item.innerHTML = `
        <div class="dest-city">${r.city} ${badges}</div>
        <div class="dest-airlines">${airlines}</div>
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

// --- Event listeners ---
document.getElementById("toggle-dep").addEventListener("click", () => {
  showDep = !showDep;
  document.getElementById("toggle-dep").classList.toggle("active", showDep);
  applyFilters();
});

document.getElementById("toggle-arr").addEventListener("click", () => {
  showArr = !showArr;
  document.getElementById("toggle-arr").classList.toggle("active", showArr);
  applyFilters();
});

document.getElementById("search").addEventListener("input", applyFilters);
document.getElementById("from-date").addEventListener("change", loadRoutes);
document.getElementById("to-date").addEventListener("change", loadRoutes);

document.getElementById("reset-dates").addEventListener("click", () => {
  document.getElementById("from-date").value = "";
  document.getElementById("to-date").value = "";
  loadRoutes();
});

// --- Boot ---
initDateDefaults();
loadRoutes();
