// HTML builders for the cards used across pages. Every dynamic value is escaped.
import { BLOOD_GROUPS } from "./config.js";
import { esc, fmtDate, timeAgo, fmtKm, telHref, avatarHtml, mapsDirectionsUrl, daysUntil, hasCoords } from "./utils.js";

export const URGENCY = {
  critical: { label: "Critical", cls: "urg-critical", icon: "lightning-charge-fill" },
  urgent: { label: "Urgent", cls: "urg-urgent", icon: "exclamation-circle-fill" },
  normal: { label: "Normal", cls: "urg-normal", icon: "clock-fill" },
};

export const urgencyBadge = (u) => {
  const x = URGENCY[u] || URGENCY.normal;
  return `<span class="urg-badge ${x.cls}"><i class="bi bi-${x.icon} me-1"></i>${x.label}</span>`;
};

const STATUS = {
  open: ["Open", "st-open"],
  fulfilled: ["Fulfilled", "st-fulfilled"],
  cancelled: ["Cancelled", "st-cancelled"],
};
export const statusBadge = (s) => {
  const [label, cls] = STATUS[s] || STATUS.open;
  return `<span class="st-badge ${cls}">${label}</span>`;
};

export const bloodChip = (g, size = "") => `<span class="blood-chip ${size}">${esc(g || "?")}</span>`;

export const emptyState = (icon, title, text = "", action = "") => `
  <div class="empty-state">
    <div class="empty-icon"><i class="bi bi-${esc(icon)}"></i></div>
    <h3 class="h6 fw-bold mb-1">${esc(title)}</h3>
    <p class="text-muted small mb-0">${esc(text)}</p>${action ? `<div class="mt-3">${action}</div>` : ""}
  </div>`;

const meta = (icon, text) => (text ? `<span><i class="bi bi-${icon} me-1"></i>${esc(text)}</span>` : "");

function neededBy(r) {
  if (!r.requiredBy) return "";
  const d = daysUntil(r.requiredBy);
  if (r.status !== "open" || d === null) return `Needed by ${fmtDate(r.requiredBy)}`;
  if (d < 0) return `Was needed ${fmtDate(r.requiredBy)}`;
  if (d === 0) return "Needed today";
  if (d === 1) return "Needed tomorrow";
  return `Needed by ${fmtDate(r.requiredBy)}`;
}

// ---------- requests ---------------------------------------------------
/** Request as seen by a donor (accept / decline / donated). */
export function requestCardDonor(r, { response, distanceKm } = {}) {
  const accepted = response?.status === "accepted";
  const declined = response?.status === "declined";
  const dir = mapsDirectionsUrl(r);
  const open = r.status === "open";
  return `
  <article class="ll-card req-card ${(URGENCY[r.urgency] || URGENCY.normal).cls} p-3 p-md-4" data-id="${esc(r.id)}">
    <div class="d-flex gap-3">
      ${bloodChip(r.bloodGroup, "lg")}
      <div class="flex-grow-1 min-w-0">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
          <h3 class="h6 fw-bold mb-0">${esc(r.patientName)}</h3>
          ${urgencyBadge(r.urgency)}
          ${r.targetDonorId ? '<span class="badge rounded-pill text-bg-dark"><i class="bi bi-person-heart me-1"></i>Sent directly to you</span>' : ""}
          ${accepted ? '<span class="st-badge st-fulfilled">You accepted</span>' : ""}
          ${declined ? '<span class="st-badge st-cancelled">You declined</span>' : ""}
          ${!open ? statusBadge(r.status) : ""}
        </div>
        <div class="req-meta">
          ${meta("hospital", r.hospital)}${meta("geo-alt", r.city)}${meta("droplet", `${r.units} unit${r.units > 1 ? "s" : ""}`)}
          ${meta("calendar-event", neededBy(r))}${distanceKm != null ? meta("signpost-2", fmtKm(distanceKm) + " away") : ""}
          ${meta("clock-history", timeAgo(r.createdAt))}
        </div>
        ${r.note ? `<p class="small text-body-secondary mt-2 mb-0">${esc(r.note)}</p>` : ""}
        ${
          accepted && r.contact
            ? `<div class="contact-box mt-3"><i class="bi bi-telephone-fill me-2"></i>Contact for ${esc(r.patientName)}:
               <a class="fw-semibold" href="${esc(telHref(r.contact))}">${esc(r.contact)}</a></div>`
            : ""
        }
      </div>
    </div>
    <div class="d-flex flex-wrap gap-2 mt-3 justify-content-end">
      ${dir ? `<a class="btn btn-light btn-sm" href="${esc(dir)}" target="_blank" rel="noopener"><i class="bi bi-sign-turn-right me-1"></i>Directions</a>` : ""}
      ${open && !accepted ? `<button class="btn btn-primary btn-sm" data-action="accept" data-id="${esc(r.id)}"><i class="bi bi-check2-circle me-1"></i>Accept</button>` : ""}
      ${open && accepted ? `<button class="btn btn-success btn-sm" data-action="donated" data-id="${esc(r.id)}"><i class="bi bi-droplet-fill me-1"></i>I've donated</button>` : ""}
      ${open && !declined ? `<button class="btn btn-outline-secondary btn-sm" data-action="decline" data-id="${esc(r.id)}">${accepted ? "Withdraw" : "Decline"}</button>` : ""}
    </div>
  </article>`;
}

/** Request as seen by the receiver who created it (with donor responses). */
export function requestCardReceiver(r) {
  const all = Object.values(r.responses || {});
  const acc = all.filter((x) => x.status === "accepted").sort((a, b) => a.at - b.at);
  const dec = all.filter((x) => x.status === "declined");
  const open = r.status === "open";
  return `
  <article class="ll-card req-card ${(URGENCY[r.urgency] || URGENCY.normal).cls} p-3 p-md-4" data-id="${esc(r.id)}">
    <div class="d-flex gap-3">
      ${bloodChip(r.bloodGroup, "lg")}
      <div class="flex-grow-1 min-w-0">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
          <h3 class="h6 fw-bold mb-0">${esc(r.patientName)}</h3>
          ${urgencyBadge(r.urgency)}${statusBadge(r.status)}
          ${r.targetDonorName ? `<span class="badge rounded-pill text-bg-dark"><i class="bi bi-person-heart me-1"></i>Direct to ${esc(r.targetDonorName)}</span>` : ""}
        </div>
        <div class="req-meta">
          ${meta("hospital", r.hospital)}${meta("geo-alt", r.city)}${meta("droplet", `${r.units} unit${r.units > 1 ? "s" : ""}`)}
          ${meta("calendar-event", neededBy(r))}${meta("clock-history", "Posted " + timeAgo(r.createdAt))}
        </div>
        <div class="resp-summary mt-2">
          <span class="${acc.length ? "text-success fw-semibold" : "text-muted"}"><i class="bi bi-hand-thumbs-up-fill me-1"></i>${acc.length} accepted</span>
          <span class="text-muted ms-3"><i class="bi bi-hand-thumbs-down me-1"></i>${dec.length} declined</span>
        </div>
        ${
          acc.length
            ? `<ul class="resp-list list-unstyled mt-2 mb-0">${acc
                .map(
                  (a) => `<li>
                    <span class="fw-semibold">${esc(a.name)}</span>
                    ${bloodChip(a.bloodGroup, "sm")}
                    <span class="text-muted small">${esc(a.city || "")} · ${timeAgo(a.at)}</span>
                    ${a.phone ? `<a class="btn btn-sm btn-outline-primary ms-auto" href="${esc(telHref(a.phone))}"><i class="bi bi-telephone me-1"></i>${esc(a.phone)}</a>` : ""}
                  </li>`
                )
                .join("")}</ul>`
            : open
            ? '<p class="small text-muted mt-2 mb-0">Waiting for donors to respond. You\'ll see their contact details here as soon as someone accepts.</p>'
            : ""
        }
      </div>
    </div>
    <div class="d-flex flex-wrap gap-2 mt-3 justify-content-end">
      ${open ? `<button class="btn btn-success btn-sm" data-action="fulfil" data-id="${esc(r.id)}"><i class="bi bi-check2-all me-1"></i>Mark fulfilled</button>
                <button class="btn btn-outline-secondary btn-sm" data-action="cancel" data-id="${esc(r.id)}">Cancel request</button>` : ""}
      <button class="btn btn-outline-danger btn-sm" data-action="delete" data-id="${esc(r.id)}"><i class="bi bi-trash3"></i></button>
    </div>
  </article>`;
}

// ---------- donors / banks / camps -------------------------------------
export function donorCard(d, { distanceKm, exact = true } = {}) {
  return `
  <article class="ll-card donor-card p-3" data-id="${esc(d.id)}">
    <div class="d-flex align-items-center gap-3">
      ${avatarHtml(d, 52)}
      <div class="flex-grow-1 min-w-0">
        <div class="d-flex align-items-center gap-2">
          <h3 class="h6 fw-bold mb-0 text-truncate">${esc(d.name)}</h3>
          ${bloodChip(d.bloodGroup, "sm")}
        </div>
        <div class="small text-muted">
          <i class="bi bi-geo-alt me-1"></i>${esc(d.city || "Location not set")}
          ${distanceKm != null ? ` · <span class="text-body fw-semibold">${exact ? "" : "≈ "}${esc(fmtKm(distanceKm))}</span>` : ""}
        </div>
        <span class="avail-dot ${d.available ? "on" : ""}">${d.available ? "Available" : "Unavailable"}</span>
      </div>
      <button class="btn btn-primary btn-sm flex-shrink-0" data-action="request-donor" data-id="${esc(d.id)}">
        <i class="bi bi-send me-1"></i>Request
      </button>
    </div>
  </article>`;
}

export const stockChips = (stock = {}) =>
  `<div class="stock-row">${BLOOD_GROUPS.map((g) => {
    const n = Number(stock[g]) || 0;
    return `<span class="stock ${n <= 0 ? "out" : n < 5 ? "low" : ""}" title="${esc(g)}: ${n} unit(s)">${esc(g)} <b>${n}</b></span>`;
  }).join("")}</div>`;

export function bankCard(b, { distanceKm, focus = false } = {}) {
  const dir = mapsDirectionsUrl(b);
  return `
  <article class="ll-card place-card p-3" data-id="${esc(b.id)}">
    <div class="d-flex gap-3">
      <div class="place-icon bank"><i class="bi bi-hospital"></i></div>
      <div class="flex-grow-1 min-w-0">
        <h3 class="h6 fw-bold mb-1">${esc(b.name)}</h3>
        <div class="req-meta">
          ${meta("geo-alt", [b.address, b.city].filter(Boolean).join(", "))}
          ${meta("clock", b.hours)}
          ${distanceKm != null ? meta("signpost-2", fmtKm(distanceKm) + " away") : ""}
        </div>
        ${stockChips(b.stock)}
        <div class="d-flex flex-wrap gap-2 mt-2">
          ${b.phone ? `<a class="btn btn-outline-primary btn-sm" href="${esc(telHref(b.phone))}"><i class="bi bi-telephone me-1"></i>${esc(b.phone)}</a>` : ""}
          ${dir ? `<a class="btn btn-light btn-sm" href="${esc(dir)}" target="_blank" rel="noopener"><i class="bi bi-sign-turn-right me-1"></i>Directions</a>` : ""}
          ${focus && hasCoords(b) ? `<button class="btn btn-light btn-sm" data-focus="bank:${esc(b.id)}"><i class="bi bi-pin-map me-1"></i>Show on map</button>` : ""}
        </div>
      </div>
    </div>
  </article>`;
}

export function campCard(c, { distanceKm, focus = false } = {}) {
  const dir = mapsDirectionsUrl(c);
  const d = daysUntil(c.date);
  const when = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d > 1 ? `In ${d} days` : "";
  return `
  <article class="ll-card place-card p-3" data-id="${esc(c.id)}">
    <div class="d-flex gap-3">
      <div class="date-tile"><span>${esc(new Date(c.date + "T00:00").toLocaleDateString(undefined, { month: "short" }))}</span><b>${esc(new Date(c.date + "T00:00").getDate())}</b></div>
      <div class="flex-grow-1 min-w-0">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
          <h3 class="h6 fw-bold mb-0">${esc(c.title)}</h3>
          ${when ? `<span class="badge rounded-pill text-bg-light border">${when}</span>` : ""}
        </div>
        <div class="req-meta">
          ${meta("people", c.organizer)}${meta("clock", c.time)}
          ${meta("geo-alt", [c.venue, c.city].filter(Boolean).join(", "))}
          ${distanceKm != null ? meta("signpost-2", fmtKm(distanceKm) + " away") : ""}
        </div>
        ${c.description ? `<p class="small text-body-secondary mt-2 mb-0">${esc(c.description)}</p>` : ""}
        <div class="d-flex flex-wrap gap-2 mt-2">
          ${c.contact ? `<a class="btn btn-outline-primary btn-sm" href="${esc(telHref(c.contact))}"><i class="bi bi-telephone me-1"></i>${esc(c.contact)}</a>` : ""}
          ${dir ? `<a class="btn btn-light btn-sm" href="${esc(dir)}" target="_blank" rel="noopener"><i class="bi bi-sign-turn-right me-1"></i>Directions</a>` : ""}
          ${focus && hasCoords(c) ? `<button class="btn btn-light btn-sm" data-focus="camp:${esc(c.id)}"><i class="bi bi-pin-map me-1"></i>Show on map</button>` : ""}
        </div>
      </div>
    </div>
  </article>`;
}
