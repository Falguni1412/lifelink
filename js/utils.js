// Pure helpers (no Firebase, no network) shared by every page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape any user-provided value before putting it into an HTML string. */
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

export const initials = (name = "") =>
  String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase() || "?";

export const isPhone = (v) => /^\+?[\d\s-]{7,16}$/.test(String(v || "").trim());
export const telHref = (v) => "tel:" + String(v || "").replace(/[^\d+]/g, "");
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

export const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/** Round coordinates to ~1 km so a donor's exact home is never published. */
export const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// ---------- dates ------------------------------------------------------
const toDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

export const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export const addDaysISO = (v, n) => {
  const d = toDate(v) || new Date();
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export const daysUntil = (v) => {
  const d = toDate(v);
  if (!d) return null;
  const t = toDate(todayISO());
  return Math.round((d - t) / 86400000);
};

export const fmtDate = (v) => {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
};

export const fmtDateTime = (v) => {
  const d = toDate(v);
  return d
    ? d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
};

export const timeAgo = (ms) => {
  if (!ms) return "";
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d > 1 ? "s" : ""} ago` : fmtDate(ms);
};

// ---------- geo --------------------------------------------------------
export const hasCoords = (p) =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Great-circle distance in km between {lat,lng} points. */
export function haversine(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtKm = (km) =>
  km === null || km === undefined ? "" : km < 1 ? "< 1 km" : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

export const mapsDirectionsUrl = (p) =>
  hasCoords(p) ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : null;

// ---------- images -----------------------------------------------------
/** Ask Cloudinary for a small cropped version of an uploaded photo. */
export function thumb(url, px = 96) {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/c_fill,g_auto,w_${px},h_${px},f_auto,q_auto/`);
  }
  return url;
}

export function avatarHtml(p, size = 40) {
  const style = `style="--s:${size}px"`;
  if (p?.photoURL) {
    return `<span class="avatar" ${style}><img src="${esc(thumb(p.photoURL, size * 2))}" alt="" loading="lazy"></span>`;
  }
  return `<span class="avatar avatar-initials" ${style}>${esc(initials(p?.name))}</span>`;
}

/** The only fields of a donor that other signed-in users may read. */
export const publicDonor = (u, available = true) => ({
  uid: u.uid || u.id,
  name: u.name || "",
  bloodGroup: u.bloodGroup || "",
  city: u.city || "",
  lat: round2(u.lat),
  lng: round2(u.lng),
  available: !!available,
  photoURL: u.photoURL || "",
  createdAt: u.createdAt || Date.now(),
});
