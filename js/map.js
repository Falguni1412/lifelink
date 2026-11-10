// Leaflet helpers (OpenStreetMap tiles, no API key needed).
// Swapping to Google Maps later only requires changing this file.
import { MAP_DEFAULT } from "./config.js";
import { esc } from "./utils.js";

export function createMap(el, { lat, lng, zoom, scrollWheelZoom = true } = {}) {
  const ok = Number.isFinite(lat) && Number.isFinite(lng);
  const map = L.map(el, { scrollWheelZoom }).setView(
    [ok ? lat : MAP_DEFAULT.lat, ok ? lng : MAP_DEFAULT.lng],
    zoom ?? (ok ? 13 : MAP_DEFAULT.zoom)
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  return map;
}

/** Teardrop marker. kind: donor | bank | camp | me | req */
export function pin(label = "", kind = "donor") {
  return L.divIcon({
    className: "pin-wrap",
    html: `<div class="drop-pin ${kind}"><span>${esc(label)}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 40],
    popupAnchor: [0, -38],
  });
}

/**
 * Click-to-place / drag location picker.
 * Returns { map, set(lat,lng), get(), clear(), invalidate() }.
 */
export function pickerMap(el, { lat, lng, onChange } = {}) {
  const has = Number.isFinite(lat) && Number.isFinite(lng);
  const map = createMap(el, { lat: has ? lat : undefined, lng: has ? lng : undefined, zoom: has ? 14 : undefined });
  let marker = null;
  let point = null;

  const place = (la, ln, center) => {
    point = { lat: la, lng: ln };
    if (!marker) {
      marker = L.marker([la, ln], { draggable: true, icon: pin("", "me") }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        point = { lat: p.lat, lng: p.lng };
        onChange?.(point);
      });
    } else {
      marker.setLatLng([la, ln]);
    }
    if (center) map.setView([la, ln], Math.max(map.getZoom(), 14));
    onChange?.(point);
  };

  if (has) place(lat, lng, false);
  map.on("click", (e) => place(e.latlng.lat, e.latlng.lng, false));

  return {
    map,
    set: (la, ln) => place(la, ln, true),
    get: () => point,
    clear() {
      if (marker) marker.remove();
      marker = null;
      point = null;
      onChange?.(null);
    },
    invalidate: () => map.invalidateSize(),
  };
}

export const geolocate = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation isn't supported by this browser."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? "Location permission was denied." : "Couldn't determine your location.")),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

/** Free-text place search via OpenStreetMap Nominatim (light, user-triggered use only). */
export async function searchPlace(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error("Place search is unavailable right now.");
  return (await r.json()).map((x) => ({ lat: +x.lat, lng: +x.lon, label: x.display_name }));
}

/**
 * Wire up the standard location controls used by forms:
 *   #<prefix>-map, #<prefix>-locate, #<prefix>-place-q, #<prefix>-place-go, #<prefix>-coords
 */
export function wireLocationPicker(prefix, { lat, lng, onChange, toast } = {}) {
  const el = document.getElementById(`${prefix}-map`);
  const coords = document.getElementById(`${prefix}-coords`);
  const pm = pickerMap(el, {
    lat,
    lng,
    onChange: (p) => {
      if (coords) coords.textContent = p ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : "No location selected";
      onChange?.(p);
    },
  });
  if (coords && !pm.get()) coords.textContent = "No location selected";

  document.getElementById(`${prefix}-locate`)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const p = await geolocate();
      pm.set(p.lat, p.lng);
    } catch (err) {
      toast?.(err.message, "warning");
    } finally {
      btn.disabled = false;
    }
  });

  const go = async () => {
    const q = document.getElementById(`${prefix}-place-q`)?.value.trim();
    if (!q) return;
    try {
      const res = await searchPlace(q);
      if (!res.length) return toast?.("No matching place found. Try a nearby landmark or click the map.", "warning");
      pm.set(res[0].lat, res[0].lng);
    } catch (err) {
      toast?.(err.message, "warning");
    }
  };
  document.getElementById(`${prefix}-place-go`)?.addEventListener("click", go);
  document.getElementById(`${prefix}-place-q`)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  });
  return pm;
}
