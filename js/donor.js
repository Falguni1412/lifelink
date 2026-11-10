import * as db from "./db.js";
import { BLOOD_GROUPS, CAN_DONATE_TO, DONATION_GAP_DAYS } from "./config.js";
import {
  $, $$, esc, toast, confirmDialog, setBusy, friendlyError, requireRole, initShell, onSection, fillUserChrome,
  fmtDate, haversine, hasCoords, todayISO, addDaysISO, daysUntil, isPhone, uploadImage, publicDonor, logActivity,
  urgencyRank, goTo,
} from "./common.js";
import { requestCardDonor, emptyState } from "./components.js";
import { wireLocationPicker } from "./map.js";
import { createNearby } from "./nearby.js";

const me = await requireRole(["donor"]);
let user = me.profile; // private profile (users/{uid})
let pub = (await db.getDocument("donors", me.uid)) || publicDonor(user, true); // public donor card
let requests = [];
let donations = [];
let tab = "matching";
let firstRequestsLoad = true;
const knownIds = new Set();

initShell("overview");
fillUserChrome(user);

const ref = () => (hasCoords(user) ? { lat: user.lat, lng: user.lng } : null);
const myResponse = (r) => r.responses?.[me.uid];
const distanceTo = (r) => (hasCoords(ref()) && hasCoords(r) ? haversine(ref(), r) : null);

/** Open requests this donor could help with (compatible group, not aimed at someone else). */
const matchingRequests = () =>
  requests.filter(
    (r) =>
      r.status === "open" &&
      r.receiverId !== me.uid &&
      (CAN_DONATE_TO[user.bloodGroup] || []).includes(r.bloodGroup) &&
      (!r.targetDonorId || r.targetDonorId === me.uid)
  );

const priority = (a, b) =>
  (urgencyRank[a.urgency] ?? 3) - (urgencyRank[b.urgency] ?? 3) ||
  (distanceTo(a) ?? 1e9) - (distanceTo(b) ?? 1e9) ||
  b.createdAt - a.createdAt;

const lastDonationDate = () => {
  const dates = [user.lastDonation, ...donations.map((d) => d.date)].filter(Boolean).sort();
  return dates[dates.length - 1] || "";
};

// =====================================================================
//  RENDER
// =====================================================================
function renderOverview() {
  $("#hello-name").textContent = (user.name || "").split(" ")[0] || "there";
  $("#my-group").textContent = user.bloodGroup || "?";
  $("#my-city").textContent = user.city || "";

  const pending = matchingRequests().filter((r) => !myResponse(r));
  const units = donations.reduce((s, d) => s + (Number(d.units) || 1), 0);
  $("#stat-donations").textContent = donations.length;
  $("#stat-lives").textContent = units * 3;
  $("#stat-pending").textContent = pending.length;

  const last = lastDonationDate();
  let eligible = "Eligible now";
  if (last) {
    const left = daysUntil(addDaysISO(last, DONATION_GAP_DAYS));
    if (left > 0) eligible = fmtDate(addDaysISO(last, DONATION_GAP_DAYS));
  }
  $("#stat-eligible").textContent = eligible;

  const crit = pending.filter((r) => r.urgency === "critical").length;
  $("#hello-sub").textContent = pending.length
    ? `${pending.length} compatible request${pending.length > 1 ? "s" : ""} need${pending.length > 1 ? "" : "s"} help${crit ? `, ${crit} critical` : ""}.`
    : "No open requests match your blood group right now. Thank you for being ready.";

  $("#availability-switch").checked = !!pub.available;
  $("#avail-dot").className = `avail-dot ${pub.available ? "on" : ""}`;
  $("#avail-dot").textContent = pub.available ? "Available to donate" : "Unavailable";
  $("#avail-text").textContent = pub.available
    ? "You're visible to receivers searching for donors."
    : "You're hidden from donor searches.";

  const top = [...pending].sort(priority).slice(0, 3);
  $("#overview-alerts").innerHTML = top.length
    ? top.map((r) => requestCardDonor(r, { response: myResponse(r), distanceKm: distanceTo(r) })).join("")
    : emptyState("check2-circle", "You're all caught up", "New compatible requests will show up here instantly.");
}

function renderRequests() {
  const matching = matchingRequests();
  const mine = (s) => requests.filter((r) => myResponse(r)?.status === s);
  const lists = {
    matching: matching.filter((r) => !myResponse(r)),
    accepted: mine("accepted"),
    declined: mine("declined"),
  };
  Object.entries(lists).forEach(([k, v]) => ($(`#c-${k}`).textContent = v.length));

  const pendingCount = lists.matching.length;
  const badge = $("#nav-req-badge");
  badge.textContent = pendingCount;
  badge.classList.toggle("d-none", !pendingCount);
  const dot = $("#bell-dot");
  dot.textContent = pendingCount;
  dot.classList.toggle("d-none", !pendingCount);

  $("#unavail-note").classList.toggle("d-none", !!pub.available);

  const items = [...lists[tab]].sort(priority);
  const empty = {
    matching: ["inbox", "No new requests", `We only show open requests compatible with ${user.bloodGroup || "your blood group"}.`],
    accepted: ["hand-thumbs-up", "Nothing accepted yet", "Requests you accept will appear here with the contact details."],
    declined: ["hand-thumbs-down", "Nothing declined", "Requests you decline are listed here."],
  }[tab];
  $("#req-list").innerHTML = items.length
    ? items.map((r) => requestCardDonor(r, { response: myResponse(r), distanceKm: distanceTo(r) })).join("")
    : emptyState(...empty);
}

function renderHistory() {
  const rows = [...donations].sort((a, b) => (a.date < b.date ? 1 : -1));
  $("#history-body").innerHTML = rows.length
    ? rows
        .map(
          (d) => `<tr>
          <td class="fw-semibold">${esc(fmtDate(d.date))}</td>
          <td>${esc(d.location || "—")}</td>
          <td>${esc(d.units || 1)}</td>
          <td class="text-muted">${esc(d.note || "")}${d.requestId ? ' <span class="badge text-bg-light border">Emergency request</span>' : ""}</td>
          <td class="text-end"><button class="btn btn-sm btn-outline-danger" data-action="del-donation" data-id="${esc(d.id)}" aria-label="Delete"><i class="bi bi-trash3"></i></button></td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="5">${emptyState("droplet", "No donations logged yet", "Log your first donation to start your history.")}</td></tr>`;
}

const renderAll = () => {
  renderOverview();
  renderRequests();
  renderHistory();
};

// =====================================================================
//  LIVE DATA
// =====================================================================
const onListenError = (e) => {
  if (e?.code === "permission-denied") toast("Permission denied while loading data. Check your Firestore rules (see README).", "danger");
};

db.subscribe(
  "requests",
  (list) => {
    requests = list;
    // announce brand-new compatible requests (not on first load)
    if (!firstRequestsLoad) {
      matchingRequests()
        .filter((r) => !knownIds.has(r.id) && !myResponse(r))
        .forEach((r) =>
          toast(`${r.urgency === "critical" ? "Critical: " : "New request: "}${r.bloodGroup} needed at ${r.hospital}`, r.urgency === "critical" ? "danger" : "info")
        );
    }
    list.forEach((r) => knownIds.add(r.id));
    firstRequestsLoad = false;
    renderAll();
  },
  undefined,
  onListenError
);

db.subscribe(
  "donations",
  (list) => {
    donations = list;
    renderAll();
  },
  { where: [["donorId", "==", me.uid]] },
  onListenError
);

const nearby = createNearby($("#sec-nearby"), ref);
let banks = [];
let camps = [];
db.subscribe("bloodBanks", (l) => ((banks = l), nearby.setData(banks, camps)), undefined, onListenError);
db.subscribe("camps", (l) => ((camps = l), nearby.setData(banks, camps)), undefined, onListenError);
onSection("nearby", () => nearby.refresh());

// =====================================================================
//  ACTIONS
// =====================================================================
$("#availability-switch").addEventListener("change", async (e) => {
  const on = e.target.checked;
  try {
    await db.setDocument("donors", me.uid, publicDonor(user, on));
    pub = { ...pub, available: on };
    renderAll();
    toast(on ? "You're now visible to receivers." : "You're now hidden from donor searches.", on ? "success" : "info");
  } catch (err) {
    e.target.checked = !on;
    toast(friendlyError(err), "danger");
  }
});

async function respond(id, status) {
  const r = requests.find((x) => x.id === id);
  if (!r) return;
  if (r.status !== "open") return toast("This request is no longer open.", "warning");
  const entry =
    status === "accepted"
      ? { status, name: user.name, phone: user.phone, city: user.city, bloodGroup: user.bloodGroup, at: Date.now() }
      : { status, name: user.name, at: Date.now() };
  try {
    await db.updateDocument("requests", id, { [`responses.${me.uid}`]: entry });
    if (status === "accepted") {
      toast("Thank you! Your phone number was shared with the receiver.");
      logActivity("response", `${user.name} accepted a ${r.bloodGroup} request at ${r.hospital}`, user);
    } else {
      toast("Response saved.", "info");
    }
  } catch (err) {
    toast(friendlyError(err), "danger");
  }
}

const donationModal = new bootstrap.Modal($("#donation-modal"));
function openDonation(req) {
  $("#donation-form").reset();
  $("#d-date").value = todayISO();
  $("#d-date").max = todayISO();
  $("#d-request").value = req?.id || "";
  $("#d-where").value = req?.hospital || "";
  $("#d-note").value = req ? `For ${req.patientName}` : "";
  $("#d-pause").checked = true;
  donationModal.show();
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, id } = b.dataset;
  if (action === "accept") respond(id, "accepted");
  else if (action === "decline") respond(id, "declined");
  else if (action === "donated") openDonation(requests.find((r) => r.id === id));
  else if (action === "del-donation") {
    if (await confirmDialog("This removes the entry from your history.", { title: "Delete this donation?", okText: "Delete", danger: true })) {
      try {
        await db.deleteDocument("donations", id);
        toast("Donation removed.", "info");
      } catch (err) {
        toast(friendlyError(err), "danger");
      }
    }
  }
});

$("#btn-log").addEventListener("click", () => openDonation(null));

$("#donation-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = $("#d-date").value;
  const where = $("#d-where").value.trim();
  const units = Math.max(1, Math.min(4, parseInt($("#d-units").value, 10) || 1));
  if (!date || !where) return toast("Please fill in the date and where you donated.", "warning");
  const btn = $("#d-save");
  setBusy(btn, true, "Saving…");
  try {
    const reqId = $("#d-request").value || null;
    await db.addDocument("donations", {
      donorId: me.uid, donorName: user.name, requestId: reqId, bloodGroup: user.bloodGroup,
      date, location: where, units, note: $("#d-note").value.trim(), createdAt: Date.now(),
    });
    if (!user.lastDonation || date > user.lastDonation) {
      await db.updateDocument("users", me.uid, { lastDonation: date });
      user = { ...user, lastDonation: date };
    }
    if ($("#d-pause").checked && pub.available) {
      await db.setDocument("donors", me.uid, publicDonor(user, false));
      pub = { ...pub, available: false };
    }
    logActivity("donation", `${user.name} logged a donation`, user);
    donationModal.hide();
    toast("Donation saved. Thank you for giving blood!");
    renderAll();
  } catch (err) {
    toast(friendlyError(err), "danger");
  } finally {
    setBusy(btn, false);
  }
});

$$("#req-tabs [data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    $$("#req-tabs .nav-link").forEach((x) => x.classList.toggle("active", x === b));
    renderRequests();
  })
);

// =====================================================================
//  PROFILE
// =====================================================================
$("#p-group").innerHTML = BLOOD_GROUPS.map((g) => `<option>${esc(g)}</option>`).join("");
let profilePicker = null;

function fillProfile() {
  $("#p-name").value = user.name || "";
  $("#p-phone").value = user.phone || "";
  $("#p-email").value = user.email || me.email || "";
  $("#p-city").value = user.city || "";
  $("#p-group").value = user.bloodGroup || "";
  $("#p-last").value = user.lastDonation || "";
  $("#p-last").max = todayISO();
  $("#p-photo-preview").innerHTML = user.photoURL ? `<img alt="" src="${esc(user.photoURL)}">` : '<i class="bi bi-person"></i>';
}
fillProfile();

onSection("profile", () => {
  if (!profilePicker) {
    profilePicker = wireLocationPicker("p", { lat: user.lat, lng: user.lng, toast });
  }
  profilePicker.invalidate();
});

$("#p-photo").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f && f.type.startsWith("image/")) $("#p-photo-preview").innerHTML = `<img alt="" src="${URL.createObjectURL(f)}">`;
});

$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#p-name").value.trim();
  const phone = $("#p-phone").value.trim();
  const city = $("#p-city").value.trim();
  if (name.length < 2 || !city) return toast("Please enter your name and city.", "warning");
  if (!isPhone(phone)) return toast("Enter a valid phone number.", "warning");
  const btn = $("#p-save");
  setBusy(btn, true, "Saving…");
  try {
    let photoURL = user.photoURL || "";
    const file = $("#p-photo").files[0];
    if (file) {
      try {
        photoURL = (await uploadImage(file)) || photoURL;
      } catch (err) {
        toast(err.message, "warning");
      }
    }
    const loc = profilePicker?.get();
    const patch = {
      name, phone, city, photoURL,
      bloodGroup: $("#p-group").value,
      lastDonation: $("#p-last").value || "",
      lat: loc ? loc.lat : user.lat ?? null,
      lng: loc ? loc.lng : user.lng ?? null,
    };
    await db.updateDocument("users", me.uid, patch);
    user = { ...user, ...patch };
    await db.setDocument("donors", me.uid, publicDonor(user, pub.available));
    pub = { ...pub, ...publicDonor(user, pub.available) };
    fillUserChrome(user);
    renderAll();
    nearby.setData(banks, camps);
    toast("Profile updated.");
  } catch (err) {
    toast(friendlyError(err), "danger");
  } finally {
    setBusy(btn, false);
  }
});
