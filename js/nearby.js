// "Blood banks & donation camps" map + list, shared by donor and receiver dashboards.
// Markup contract (inside `root`): [data-nb=map] [data-nb=list] [data-nb=group] [data-nb=q] [data-nb=kind]
import { BLOOD_GROUPS } from "./config.js";
import { $, esc, haversine, todayISO, hasCoords } from "./utils.js";
import { createMap, pin } from "./map.js";
import { bankCard, campCard, emptyState } from "./components.js";

export function createNearby(root, getRef) {
  const mapEl = $("[data-nb=map]", root);
  const listEl = $("[data-nb=list]", root);
  const groupSel = $("[data-nb=group]", root);
  const qInp = $("[data-nb=q]", root);
  const kindSel = $("[data-nb=kind]", root);

  groupSel.innerHTML =
    '<option value="">Any blood group in stock</option>' + BLOOD_GROUPS.map((g) => `<option>${esc(g)}</option>`).join("");

  let map = null;
  let layer = null;
  let banks = [];
  let camps = [];
  const markers = {};

  const ensureMap = () => {
    if (map) return;
    map = createMap(mapEl);
    layer = L.layerGroup().addTo(map);
  };

  function render() {
    const ref = getRef?.();
    const q = (qInp.value || "").trim().toLowerCase();
    const g = groupSel.value;
    const kind = kindSel.value;
    const dist = (x) => (hasCoords(ref) && hasCoords(x) ? haversine(ref, x) : null);
    const byDist = (a, b) => (a._d ?? 1e9) - (b._d ?? 1e9);
    const hay = (...p) => p.join(" ").toLowerCase();

    const B =
      kind === "camps"
        ? []
        : banks
            .filter((b) => (!q || hay(b.name, b.city, b.address).includes(q)) && (!g || (Number(b.stock?.[g]) || 0) > 0))
            .map((b) => ({ ...b, _d: dist(b) }))
            .sort(byDist);
    const C =
      kind === "banks" || g
        ? []
        : camps
            .filter((c) => c.date >= todayISO() && (!q || hay(c.title, c.city, c.venue, c.organizer).includes(q)))
            .map((c) => ({ ...c, _d: dist(c) }))
            .sort((a, b) => (a.date < b.date ? -1 : 1));

    listEl.innerHTML =
      B.length || C.length
        ? B.map((b) => bankCard(b, { distanceKm: b._d, focus: true })).join("") +
          C.map((c) => campCard(c, { distanceKm: c._d, focus: true })).join("")
        : emptyState("pin-map", "Nothing matches", g ? `No blood bank currently lists ${g} in stock.` : "Try a different search or filter.");

    if (!map) return;
    layer.clearLayers();
    Object.keys(markers).forEach((k) => delete markers[k]);
    const pts = [];
    B.filter(hasCoords).forEach((b) => {
      const m = L.marker([b.lat, b.lng], { icon: pin("+", "bank") }).addTo(layer);
      m.bindPopup(`<strong>${esc(b.name)}</strong><br>${esc(b.address || b.city || "")}<br>${esc(b.hours || "")}`);
      markers[`bank:${b.id}`] = m;
      pts.push([b.lat, b.lng]);
    });
    C.filter(hasCoords).forEach((c) => {
      const m = L.marker([c.lat, c.lng], { icon: pin("★", "camp") }).addTo(layer);
      m.bindPopup(`<strong>${esc(c.title)}</strong><br>${esc(c.venue || "")}, ${esc(c.city || "")}<br>${esc(c.date)} · ${esc(c.time || "")}`);
      markers[`camp:${c.id}`] = m;
      pts.push([c.lat, c.lng]);
    });
    if (hasCoords(ref)) {
      L.marker([ref.lat, ref.lng], { icon: pin("You", "me") }).addTo(layer).bindPopup("Your saved location");
      pts.push([ref.lat, ref.lng]);
    }
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
  }

  [groupSel, kindSel].forEach((el) => el.addEventListener("change", render));
  qInp.addEventListener("input", render);

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-focus]");
    const m = btn && markers[btn.dataset.focus];
    if (!m) return;
    mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    map.setView(m.getLatLng(), 15);
    m.openPopup();
  });

  return {
    setData(b, c) {
      banks = b;
      camps = c;
      render();
    },
    /** Call whenever the section becomes visible. */
    refresh() {
      ensureMap();
      map.invalidateSize();
      render();
    },
  };
}
