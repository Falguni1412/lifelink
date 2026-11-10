import * as db from "./db.js";
import { BLOOD_GROUPS, CAN_RECEIVE_FROM } from "./config.js";
import { $, $$, esc, todayISO, dashFor, injectDemoBadge } from "./common.js";
import { bankCard, campCard, emptyState } from "./components.js";
import { createMap, pin } from "./map.js";

injectDemoBadge();
$("#yr").textContent = new Date().getFullYear();

// ---------- nav: show Dashboard when signed in ----------
db.onAuthChange(async (u) => {
  const slot = $("#nav-auth");
  if (!u) return;
  let role = "donor";
  try {
    role = (await db.getDocument("users", u.uid))?.role || "donor";
  } catch {}
  slot.innerHTML = `<a class="btn btn-primary" href="${dashFor(role)}"><i class="bi bi-speedometer2 me-1"></i>Dashboard</a>`;
});

// ---------- compatibility table ----------
$("#compat-table").innerHTML = `
  <thead><tr><th class="text-start">Recipient ↓ / Donor →</th>${BLOOD_GROUPS.map((g) => `<th>${esc(g)}</th>`).join("")}</tr></thead>
  <tbody>${BLOOD_GROUPS.map(
    (r) => `<tr><th class="text-start text-brand">${esc(r)}</th>${BLOOD_GROUPS.map((d) =>
      CAN_RECEIVE_FROM[r].includes(d) ? '<td class="yes"><i class="bi bi-check-lg"></i></td>' : '<td class="no">–</td>'
    ).join("")}</tr>`
  ).join("")}</tbody>`;

// ---------- scroll reveal ----------
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
  { threshold: 0.12 }
);
$$(".reveal").forEach((el) => io.observe(el));

// ---------- live public data ----------
let map = null;
let layer = null;
const initMap = () => {
  if (map) return;
  map = createMap($("#home-map"), { scrollWheelZoom: false });
  layer = L.layerGroup().addTo(map);
};

function count(el, to) {
  const start = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - start) / 700);
    el.textContent = Math.round(to * p);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let firstBanks = true;
db.subscribe(
  "bloodBanks",
  (banks) => {
    initMap();
    banks.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (firstBanks) count($("#st-banks"), banks.length);
    else $("#st-banks").textContent = banks.length;
    firstBanks = false;

    $("#bank-list").innerHTML = banks.length
      ? banks.map((b) => bankCard(b)).join("")
      : emptyState("hospital", "No blood banks listed yet", "Admins can add blood banks from the admin dashboard.");

    layer.clearLayers();
    const pts = banks.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    pts.forEach((b) =>
      L.marker([b.lat, b.lng], { icon: pin("+", "bank") })
        .addTo(layer)
        .bindPopup(`<strong>${esc(b.name)}</strong><br>${esc(b.address || b.city || "")}<br>${esc(b.hours || "")}`)
    );
    if (pts.length) map.fitBounds(pts.map((b) => [b.lat, b.lng]), { padding: [40, 40], maxZoom: 9 });
  },
  undefined,
  () => ($("#bank-list").innerHTML = emptyState("exclamation-triangle", "Couldn't load blood banks", "Check your Firebase config and Firestore rules."))
);

let firstCamps = true;
db.subscribe("camps", (all) => {
  const camps = all.filter((c) => c.date >= todayISO()).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (firstCamps) count($("#st-camps"), camps.length);
  else $("#st-camps").textContent = camps.length;
  firstCamps = false;
  $("#camp-list").innerHTML = camps.length
    ? camps.slice(0, 6).map((c) => `<div class="col-md-6 col-lg-4">${campCard(c)}</div>`).join("")
    : `<div class="col-12">${emptyState("calendar-event", "No upcoming camps right now", "Check back soon. New camps are published by the LifeLink team.")}</div>`;
});
