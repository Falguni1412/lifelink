import * as db from "./db.js";
import { BLOOD_GROUPS, CAN_RECEIVE_FROM } from "./config.js";
import {
  $, $$, esc, toast, confirmDialog, setBusy, friendlyError, requireRole, initShell, onSection, fillUserChrome,
  fmtDate, timeAgo, todayISO, isPhone, logActivity, debounce, hasCoords,
} from "./common.js";
import { urgencyBadge, statusBadge, bloodChip, emptyState, bankCard, campCard } from "./components.js";
import { wireLocationPicker } from "./map.js";

const me = await requireRole(["admin"]);
const user = me.profile;

initShell("overview");
fillUserChrome(user);

// ---------- state ------------------------------------------------------
let users = [];
let donors = []; // public donor docs (availability)
let requests = [];
let banks = [];
let camps = [];
let activity = [];
let campTab = "upcoming";

const onErr = (name) => (e) =>
  e?.code === "permission-denied" && toast(`Permission denied while loading ${name}. Check your Firestore rules (see README).`, "danger");

const sub = (col, assign, render) =>
  db.subscribe(col, (l) => { assign(l); render(); }, undefined, onErr(col));

sub("users", (l) => (users = l), renderAll);
sub("donors", (l) => (donors = l), renderAll);
sub("requests", (l) => (requests = l), renderAll);
sub("bloodBanks", (l) => (banks = l), renderAll);
sub("camps", (l) => (camps = l), renderAll);
sub("activity", (l) => (activity = l), renderAll);

const groupOptions = (first) =>
  `<option value="">${first}</option>` + BLOOD_GROUPS.map((g) => `<option>${esc(g)}</option>`).join("");
$("#d-group").innerHTML = groupOptions("All blood groups");
$("#q-group").innerHTML = groupOptions("All blood groups");

const acceptedCount = (r) => Object.values(r.responses || {}).filter((x) => x.status === "accepted").length;
const donorDocFor = (uid) => donors.find((d) => d.id === uid || d.uid === uid);
const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

function renderAll() {
  renderOverview();
  renderDonors();
  renderReceivers();
  renderRequests();
  renderBanks();
  renderCamps();
  renderFeed();
}

// =====================================================================
//  OVERVIEW
// =====================================================================
function bars(el, counts, emptyText) {
  const max = Math.max(1, ...Object.values(counts));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  el.innerHTML = total
    ? BLOOD_GROUPS.map(
        (g) => `<div class="bar-row"><span class="lbl">${esc(g)}</span>
          <span class="track"><span class="fill d-block" style="width:${(counts[g] / max) * 100}%"></span></span>
          <span class="val">${counts[g]}</span></div>`
      ).join("")
    : `<p class="text-muted small mb-0">${esc(emptyText)}</p>`;
}

function renderOverview() {
  const donorUsers = users.filter((u) => u.role === "donor");
  const open = requests.filter((r) => r.status === "open");
  const today = todayISO();

  $("#st-donors").textContent = donorUsers.length;
  $("#st-receivers").textContent = users.filter((u) => u.role === "receiver").length;
  $("#st-open").textContent = open.length;
  $("#st-fulfilled").textContent = requests.filter((r) => r.status === "fulfilled").length;
  $("#st-avail").textContent = donors.filter((d) => d.available).length;
  $("#st-banks").textContent = banks.length;
  $("#st-camps").textContent = camps.filter((c) => c.date >= today).length;
  $("#st-critical").textContent = open.filter((r) => r.urgency === "critical").length;

  const supply = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, 0]));
  donors.forEach((d) => supply[d.bloodGroup] !== undefined && supply[d.bloodGroup]++);
  bars($("#group-bars"), supply, "No donors registered yet.");

  const demand = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, 0]));
  open.forEach((r) => demand[r.bloodGroup] !== undefined && (demand[r.bloodGroup] += Number(r.units) || 1));
  bars($("#demand-bars"), demand, "No open requests right now.");

  // groups where open demand (units) exceeds the available compatible donors
  const short = BLOOD_GROUPS.filter((g) => {
    if (!demand[g]) return false;
    const pool = donors.filter((d) => d.available && CAN_RECEIVE_FROM[g].includes(d.bloodGroup)).length;
    return pool < demand[g];
  });
  $("#gap-note").innerHTML = short.length
    ? `<i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Shortage risk: fewer available compatible donors than units needed for <b>${short.map(esc).join(", ")}</b>. Consider a camp or contacting blood banks.`
    : demand && Object.values(demand).some(Boolean)
    ? '<i class="bi bi-check-circle-fill text-success me-1"></i>Enough compatible donors are available for every open request.'
    : "";

  const recent = [...activity].sort(byNewest).slice(0, 5);
  $("#mini-feed").innerHTML = recent.length ? recent.map(feedItem).join("") : emptyState("activity", "No activity yet");
}

// =====================================================================
//  DONORS
// =====================================================================
function donorStatus(u) {
  if (u.blocked) return "blocked";
  return donorDocFor(u.id)?.available ? "available" : "unavailable";
}
const statusPill = {
  available: '<span class="avail-dot on">Available</span>',
  unavailable: '<span class="avail-dot">Unavailable</span>',
  blocked: '<span class="st-badge st-cancelled">Blocked</span>',
};

function renderDonors() {
  const q = $("#d-q").value.trim().toLowerCase();
  const g = $("#d-group").value;
  const s = $("#d-status").value;
  const rows = users
    .filter((u) => u.role === "donor")
    .filter((u) => !g || u.bloodGroup === g)
    .filter((u) => !s || donorStatus(u) === s)
    .filter((u) => !q || [u.name, u.email, u.city].some((x) => (x || "").toLowerCase().includes(q)))
    .sort(byNewest);

  $("#donors-body").innerHTML = rows.length
    ? rows
        .map(
          (u) => `<tr>
        <td><div class="fw-semibold">${esc(u.name)}</div><div class="small text-muted">${esc(u.email || "")}</div></td>
        <td>${bloodChip(u.bloodGroup, "sm")}</td>
        <td>${esc(u.city || "—")}</td>
        <td>${esc(u.phone || "—")}</td>
        <td>${statusPill[donorStatus(u)]}</td>
        <td>${u.lastDonation ? esc(fmtDate(u.lastDonation)) : "—"}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm ${u.blocked ? "btn-outline-success" : "btn-outline-secondary"}" data-action="block" data-id="${esc(u.id)}">${u.blocked ? "Unblock" : "Block"}</button>
          <button class="btn btn-sm btn-outline-danger" data-action="remove-user" data-id="${esc(u.id)}" aria-label="Remove donor"><i class="bi bi-trash3"></i></button>
        </td></tr>`
        )
        .join("")
    : `<tr><td colspan="7">${emptyState("droplet-half", "No donors found", "Try changing the filters.")}</td></tr>`;
}

// =====================================================================
//  RECEIVERS
// =====================================================================
function renderReceivers() {
  const q = $("#rc-q").value.trim().toLowerCase();
  const rows = users
    .filter((u) => u.role === "receiver")
    .filter((u) => !q || [u.name, u.email, u.city].some((x) => (x || "").toLowerCase().includes(q)))
    .sort(byNewest);

  $("#receivers-body").innerHTML = rows.length
    ? rows
        .map((u) => {
          const mine = requests.filter((r) => r.receiverId === u.id);
          const open = mine.filter((r) => r.status === "open").length;
          return `<tr>
          <td><div class="fw-semibold">${esc(u.name)}</div><div class="small text-muted">${esc(u.email || "")}</div></td>
          <td>${esc(u.city || "—")}</td>
          <td>${esc(u.phone || "—")}</td>
          <td>${mine.length} <span class="text-muted small">(${open} open)</span></td>
          <td>${u.blocked ? '<span class="st-badge st-cancelled">Blocked</span>' : '<span class="st-badge st-fulfilled">Active</span>'}</td>
          <td>${esc(fmtDate(u.createdAt))}</td>
          <td class="text-end text-nowrap">
            <button class="btn btn-sm ${u.blocked ? "btn-outline-success" : "btn-outline-secondary"}" data-action="block" data-id="${esc(u.id)}">${u.blocked ? "Unblock" : "Block"}</button>
            <button class="btn btn-sm btn-outline-danger" data-action="remove-user" data-id="${esc(u.id)}" aria-label="Remove receiver"><i class="bi bi-trash3"></i></button>
          </td></tr>`;
        })
        .join("")
    : `<tr><td colspan="7">${emptyState("person-heart", "No receivers found")}</td></tr>`;
}

// =====================================================================
//  REQUESTS
// =====================================================================
function renderRequests() {
  const q = $("#q-q").value.trim().toLowerCase();
  const st = $("#q-status").value;
  const g = $("#q-group").value;
  const urg = $("#q-urg").value;
  const rows = requests
    .filter((r) => !st || r.status === st)
    .filter((r) => !g || r.bloodGroup === g)
    .filter((r) => !urg || r.urgency === urg)
    .filter((r) => !q || [r.patientName, r.hospital, r.city, r.receiverName].some((x) => (x || "").toLowerCase().includes(q)))
    .sort(byNewest);

  $("#requests-body").innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
        <td><div class="fw-semibold">${esc(r.patientName)}</div><div class="small text-muted">by ${esc(r.receiverName || "—")}</div></td>
        <td>${bloodChip(r.bloodGroup, "sm")} <span class="text-muted small">×${esc(r.units)}</span></td>
        <td>${esc(r.hospital || "—")}<div class="small text-muted">${esc(r.city || "")}</div></td>
        <td>${urgencyBadge(r.urgency)}</td>
        <td>${acceptedCount(r)} accepted</td>
        <td>${statusBadge(r.status)}</td>
        <td class="text-nowrap">${esc(timeAgo(r.createdAt))}</td>
        <td class="text-end text-nowrap">
          ${r.status === "open" ? `<button class="btn btn-sm btn-outline-success" data-action="req-fulfil" data-id="${esc(r.id)}">Fulfilled</button>
          <button class="btn btn-sm btn-outline-secondary" data-action="req-cancel" data-id="${esc(r.id)}">Cancel</button>` : ""}
          <button class="btn btn-sm btn-outline-danger" data-action="req-delete" data-id="${esc(r.id)}" aria-label="Delete request"><i class="bi bi-trash3"></i></button>
        </td></tr>`
        )
        .join("")
    : `<tr><td colspan="8">${emptyState("card-checklist", "No requests found", "Try changing the filters.")}</td></tr>`;
}

["#d-q", "#rc-q", "#q-q"].forEach((s) => $(s).addEventListener("input", debounce(() => { renderDonors(); renderReceivers(); renderRequests(); }, 150)));
["#d-group", "#d-status", "#q-status", "#q-group", "#q-urg"].forEach((s) => $(s).addEventListener("change", () => { renderDonors(); renderRequests(); }));

// =====================================================================
//  BLOOD BANKS
// =====================================================================
function renderBanks() {
  const list = [...banks].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  $("#banks-grid").innerHTML = list.length
    ? list
        .map(
          (b) => `<div class="col-lg-6">${bankCard(b)}
          <div class="d-flex gap-2 justify-content-end mt-2">
            <button class="btn btn-sm btn-light" data-action="bank-edit" data-id="${esc(b.id)}"><i class="bi bi-pencil me-1"></i>Edit</button>
            <button class="btn btn-sm btn-outline-danger" data-action="bank-delete" data-id="${esc(b.id)}"><i class="bi bi-trash3"></i></button>
          </div></div>`
        )
        .join("")
    : `<div class="col-12">${emptyState("hospital", "No blood banks yet", "Add the first blood bank so receivers can find stock nearby.")}</div>`;
}

const bankModal = new bootstrap.Modal($("#bank-modal"));
let bankPicker = null;

$("#b-stock").innerHTML = BLOOD_GROUPS.map(
  (g) => `<div><label for="stk-${esc(g)}">${esc(g)}</label><input class="form-control" id="stk-${esc(g)}" type="number" min="0" max="9999" value="0" data-stock="${esc(g)}"></div>`
).join("");

function openBank(b) {
  $("#bank-title").textContent = b ? "Edit blood bank" : "Add blood bank";
  $("#b-id").value = b?.id || "";
  $("#b-name").value = b?.name || "";
  $("#b-city").value = b?.city || "";
  $("#b-address").value = b?.address || "";
  $("#b-hours").value = b?.hours || "";
  $("#b-phone").value = b?.phone || "";
  $("#b-place-q").value = "";
  $$("#b-stock [data-stock]").forEach((i) => (i.value = Number(b?.stock?.[i.dataset.stock]) || 0));
  bankModal.show();
  $("#bank-modal").addEventListener(
    "shown.bs.modal",
    () => {
      if (!bankPicker) bankPicker = wireLocationPicker("b", { toast });
      bankPicker.invalidate();
      if (hasCoords(b)) bankPicker.set(b.lat, b.lng);
      else bankPicker.clear();
    },
    { once: true }
  );
}
$("#bank-add").addEventListener("click", () => openBank(null));

$("#bank-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#b-name").value.trim();
  const city = $("#b-city").value.trim();
  const phone = $("#b-phone").value.trim();
  if (!name || !city) return toast("Name and city are required.", "warning");
  if (phone && !isPhone(phone)) return toast("Enter a valid phone number.", "warning");
  const stock = {};
  $$("#b-stock [data-stock]").forEach((i) => (stock[i.dataset.stock] = Math.max(0, Math.min(9999, parseInt(i.value, 10) || 0))));
  const loc = bankPicker?.get();
  const id = $("#b-id").value;
  const doc = {
    name, city, address: $("#b-address").value.trim(), hours: $("#b-hours").value.trim(), phone, stock,
    lat: loc ? loc.lat : null, lng: loc ? loc.lng : null,
  };
  const btn = $("#b-save");
  setBusy(btn, true, "Saving…");
  try {
    if (id) await db.updateDocument("bloodBanks", id, doc);
    else await db.addDocument("bloodBanks", { ...doc, createdAt: Date.now() });
    logActivity("admin", `${user.name} ${id ? "updated" : "added"} blood bank “${name}”`, user);
    bankModal.hide();
    toast(id ? "Blood bank updated." : "Blood bank added.");
  } catch (err) {
    toast(friendlyError(err), "danger");
  } finally {
    setBusy(btn, false);
  }
});

// =====================================================================
//  CAMPS
// =====================================================================
function renderCamps() {
  const today = todayISO();
  const list = camps
    .filter((c) => (campTab === "upcoming" ? c.date >= today : c.date < today))
    .sort((a, b) => (campTab === "upcoming" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  $("#camps-grid").innerHTML = list.length
    ? list
        .map(
          (c) => `<div class="col-lg-6">${campCard(c)}
          <div class="d-flex gap-2 justify-content-end mt-2">
            <button class="btn btn-sm btn-light" data-action="camp-edit" data-id="${esc(c.id)}"><i class="bi bi-pencil me-1"></i>Edit</button>
            <button class="btn btn-sm btn-outline-danger" data-action="camp-delete" data-id="${esc(c.id)}"><i class="bi bi-trash3"></i></button>
          </div></div>`
        )
        .join("")
    : `<div class="col-12">${emptyState("calendar-event", `No ${campTab} camps`, campTab === "upcoming" ? "Add a camp to let donors know where to give blood." : "")}</div>`;
}

$$("#camp-tabs [data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    campTab = b.dataset.tab;
    $$("#camp-tabs .nav-link").forEach((x) => x.classList.toggle("active", x === b));
    renderCamps();
  })
);

const campModal = new bootstrap.Modal($("#camp-modal"));
let campPicker = null;

function openCamp(c) {
  $("#camp-title").textContent = c ? "Edit donation camp" : "Add donation camp";
  $("#c-id").value = c?.id || "";
  $("#c-title").value = c?.title || "";
  $("#c-organizer").value = c?.organizer || "";
  $("#c-contact").value = c?.contact || "";
  $("#c-date").value = c?.date || "";
  $("#c-time").value = c?.time || "";
  $("#c-city").value = c?.city || "";
  $("#c-venue").value = c?.venue || "";
  $("#c-desc").value = c?.description || "";
  $("#c-place-q").value = "";
  if (!c) $("#c-date").min = todayISO();
  else $("#c-date").removeAttribute("min");
  campModal.show();
  $("#camp-modal").addEventListener(
    "shown.bs.modal",
    () => {
      if (!campPicker) campPicker = wireLocationPicker("c", { toast });
      campPicker.invalidate();
      if (hasCoords(c)) campPicker.set(c.lat, c.lng);
      else campPicker.clear();
    },
    { once: true }
  );
}
$("#camp-add").addEventListener("click", () => openCamp(null));

$("#camp-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#c-title").value.trim();
  const organizer = $("#c-organizer").value.trim();
  const date = $("#c-date").value;
  const city = $("#c-city").value.trim();
  const venue = $("#c-venue").value.trim();
  const contact = $("#c-contact").value.trim();
  if (!title || !organizer || !date || !city || !venue) return toast("Please fill in all required fields.", "warning");
  if (contact && !isPhone(contact)) return toast("Enter a valid contact number.", "warning");
  const loc = campPicker?.get();
  const id = $("#c-id").value;
  const doc = {
    title, organizer, date, city, venue, contact, time: $("#c-time").value.trim(), description: $("#c-desc").value.trim(),
    lat: loc ? loc.lat : null, lng: loc ? loc.lng : null,
  };
  const btn = $("#c-save");
  setBusy(btn, true, "Saving…");
  try {
    if (id) await db.updateDocument("camps", id, doc);
    else await db.addDocument("camps", { ...doc, createdAt: Date.now() });
    logActivity("admin", `${user.name} ${id ? "updated" : "scheduled"} the camp “${title}” in ${city}`, user);
    campModal.hide();
    toast(id ? "Camp updated." : "Camp added.");
  } catch (err) {
    toast(friendlyError(err), "danger");
  } finally {
    setBusy(btn, false);
  }
});

// =====================================================================
//  ACTIVITY FEED
// =====================================================================
const FEED_ICON = { register: "person-plus-fill", request: "lightning-charge-fill", response: "hand-thumbs-up-fill", donation: "droplet-fill", admin: "shield-check" };
function feedItem(a) {
  return `<div class="feed-item">
    <span class="feed-dot ${esc(a.type)}"><i class="bi bi-${FEED_ICON[a.type] || "activity"}"></i></span>
    <div class="min-w-0"><div class="small">${esc(a.text)}</div><div class="text-muted" style="font-size:.72rem">${esc(timeAgo(a.createdAt))}</div></div>
  </div>`;
}
function renderFeed() {
  const list = [...activity].sort(byNewest).slice(0, 60);
  $("#feed").innerHTML = list.length ? list.map(feedItem).join("") : emptyState("activity", "No activity yet");
}

// =====================================================================
//  ACTIONS
// =====================================================================
async function safely(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
  } catch (err) {
    toast(friendlyError(err), "danger");
  }
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, id } = b.dataset;

  if (action === "block") {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    const block = !u.blocked;
    if (block && !(await confirmDialog(`${u.name} will no longer be able to use LifeLink.`, { title: "Block this user?", okText: "Block", danger: true }))) return;
    await safely(async () => {
      await db.updateDocument("users", id, { blocked: block });
      // a blocked donor must disappear from search results
      if (u.role === "donor" && donorDocFor(id)) await db.updateDocument("donors", id, { available: block ? false : donorDocFor(id).available });
      logActivity("admin", `${user.name} ${block ? "blocked" : "unblocked"} ${u.name}`, user);
    }, block ? `${u.name} blocked.` : `${u.name} unblocked.`);
  } else if (action === "remove-user") {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    if (!(await confirmDialog(`This removes ${u.name}'s LifeLink profile and public listing. Their sign-in account (Firebase Authentication) must be deleted separately in the Firebase console.`, { title: "Remove this user?", okText: "Remove", danger: true }))) return;
    await safely(async () => {
      await db.deleteDocument("users", id);
      if (u.role === "donor") await db.deleteDocument("donors", id);
      logActivity("admin", `${user.name} removed ${u.role} ${u.name}`, user);
    }, "User removed.");
  } else if (action === "req-fulfil") {
    await safely(() => db.updateDocument("requests", id, { status: "fulfilled", fulfilledAt: Date.now() }), "Request marked fulfilled.");
  } else if (action === "req-cancel") {
    if (await confirmDialog("Donors will no longer see this request.", { title: "Cancel this request?", okText: "Cancel request", danger: true }))
      await safely(() => db.updateDocument("requests", id, { status: "cancelled" }), "Request cancelled.");
  } else if (action === "req-delete") {
    if (await confirmDialog("This permanently removes the request and its responses.", { title: "Delete request?", okText: "Delete", danger: true }))
      await safely(() => db.deleteDocument("requests", id), "Request deleted.");
  } else if (action === "bank-edit") {
    openBank(banks.find((x) => x.id === id));
  } else if (action === "bank-delete") {
    const x = banks.find((v) => v.id === id);
    if (await confirmDialog(`“${x?.name}” will be removed from the nearby map.`, { title: "Delete blood bank?", okText: "Delete", danger: true }))
      await safely(async () => { await db.deleteDocument("bloodBanks", id); logActivity("admin", `${user.name} removed blood bank “${x?.name}”`, user); }, "Blood bank deleted.");
  } else if (action === "camp-edit") {
    openCamp(camps.find((x) => x.id === id));
  } else if (action === "camp-delete") {
    const x = camps.find((v) => v.id === id);
    if (await confirmDialog(`“${x?.title}” will be removed.`, { title: "Delete camp?", okText: "Delete", danger: true }))
      await safely(async () => { await db.deleteDocument("camps", id); logActivity("admin", `${user.name} removed the camp “${x?.title}”`, user); }, "Camp deleted.");
  }
});

onSection("overview", () => {});
