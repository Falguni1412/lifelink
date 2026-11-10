import * as db from "./db.js";
import { BLOOD_GROUPS, CAN_RECEIVE_FROM } from "./config.js";
import {
  $, $$, esc, toast, confirmDialog, setBusy, friendlyError, requireRole, initShell, onSection, fillUserChrome, goTo,
  haversine, hasCoords, todayISO, addDaysISO, isPhone, uploadImage, logActivity, debounce,
} from "./common.js";
import { requestCardReceiver, donorCard, emptyState } from "./components.js";
import { wireLocationPicker, createMap, pin, geolocate } from "./map.js";
import { createNearby } from "./nearby.js";

const me = await requireRole(["receiver"]);
let user = me.profile;
let myRequests = [];
let donors = [];
let ref = hasCoords(user) ? { lat: user.lat, lng: user.lng } : null; // distance reference for searches
let usingGps = false;
let tab = "open";
let direct = null; // donor a request is being sent to directly
const prevAccepted = new Map();
let firstLoad = true;

initShell("overview");
fillUserChrome(user);

const groupOptions = (first) =>
  `<option value="">${first}</option>` + BLOOD_GROUPS.map((g) => `<option>${esc(g)}</option>`).join("");
$("#s-group").innerHTML = groupOptions("Any blood group");
$("#r-group").innerHTML = groupOptions("Choose…");

const acceptedCount = (r) => Object.values(r.responses || {}).filter((x) => x.status === "accepted").length;

// =====================================================================
//  OVERVIEW + MY REQUESTS
// =====================================================================
function renderRequests() {
  const by = (s) => myRequests.filter((r) => r.status === s);
  const open = by("open");
  const sorted = (list) => [...list].sort((a, b) => b.createdAt - a.createdAt);

  $("#hello-name").textContent = (user.name || "").split(" ")[0] || "there";
  $("#stat-active").textContent = open.length;
  $("#stat-accepted").textContent = open.reduce((s, r) => s + acceptedCount(r), 0);
  $("#stat-fulfilled").textContent = by("fulfilled").length;
  $("#stat-donors").textContent = donors.filter((d) => d.available && d.uid !== me.uid).length;

  const waiting = open.filter((r) => acceptedCount(r) > 0).length;
  const badge = $("#nav-resp-badge");
  badge.textContent = waiting;
  badge.classList.toggle("d-none", !waiting);

  $("#overview-requests").innerHTML = myRequests.length
    ? sorted(myRequests).slice(0, 3).map(requestCardReceiver).join("")
    : emptyState("lightning-charge", "No requests yet", "When you need blood, post an emergency request and donors are alerted instantly.",
        '<a class="btn btn-primary btn-sm" href="#new-request">Post a request</a>');

  ["open", "fulfilled", "cancelled"].forEach((s) => ($(`#mc-${s}`).textContent = by(s).length));
  const items = sorted(by(tab));
  $("#mr-list").innerHTML = items.length
    ? items.map(requestCardReceiver).join("")
    : emptyState("inbox", `No ${tab} requests`, tab === "open" ? "Post a new request to reach compatible donors." : "Nothing here yet.");
}

db.subscribe(
  "requests",
  (list) => {
    myRequests = list;
    if (!firstLoad) {
      list.forEach((r) => {
        const n = acceptedCount(r);
        const before = prevAccepted.get(r.id) ?? 0;
        if (n > before) toast(`${n - before} new donor${n - before > 1 ? "s" : ""} accepted your ${r.bloodGroup} request for ${r.patientName}!`, "success");
      });
    }
    list.forEach((r) => prevAccepted.set(r.id, acceptedCount(r)));
    firstLoad = false;
    renderRequests();
  },
  { where: [["receiverId", "==", me.uid]] },
  (e) => e?.code === "permission-denied" && toast("Permission denied while loading requests. Check your Firestore rules (see README).", "danger")
);

$$("#mr-tabs [data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    $$("#mr-tabs .nav-link").forEach((x) => x.classList.toggle("active", x === b));
    renderRequests();
  })
);

async function setStatus(id, status, doneMsg) {
  try {
    const patch = { status };
    if (status === "fulfilled") patch.fulfilledAt = Date.now();
    await db.updateDocument("requests", id, patch);
    const r = myRequests.find((x) => x.id === id);
    logActivity("request", `${user.name} marked a ${r?.bloodGroup || ""} request as ${status}`, user);
    toast(doneMsg);
  } catch (err) {
    toast(friendlyError(err), "danger");
  }
}

// =====================================================================
//  DONOR SEARCH
// =====================================================================
db.subscribe(
  "donors",
  (list) => {
    donors = list;
    renderSearch();
    renderRequests();
  },
  { where: [["available", "==", true]] },
  (e) => e?.code === "permission-denied" && toast("Permission denied while loading donors. Check your Firestore rules (see README).", "danger")
);

let searchMap = null;
let searchLayer = null;
const donorIndex = {};

function searchResults() {
  const g = $("#s-group").value;
  const compat = $("#s-compat").checked;
  const city = $("#s-city").value.trim().toLowerCase();
  const radius = +$("#s-radius").value;
  const allowed = !g ? null : compat ? CAN_RECEIVE_FROM[g] : [g];
  return donors
    .filter((d) => d.available && d.uid !== me.uid)
    .filter((d) => !allowed || allowed.includes(d.bloodGroup))
    .filter((d) => !city || (d.city || "").toLowerCase().includes(city))
    .map((d) => ({ ...d, _d: hasCoords(ref) && hasCoords(d) ? haversine(ref, d) : null }))
    .filter((d) => !radius || (d._d !== null && d._d <= radius))
    .sort((a, b) => (g ? (a.bloodGroup === g ? 0 : 1) - (b.bloodGroup === g ? 0 : 1) : 0) || (a._d ?? 1e9) - (b._d ?? 1e9) || a.name.localeCompare(b.name));
}

function renderSearch() {
  const res = searchResults();
  res.forEach((d) => (donorIndex[d.id] = d));
  $("#s-summary").textContent = `${res.length} available donor${res.length === 1 ? "" : "s"}${
    hasCoords(ref) ? (usingGps ? " · sorted by distance from your current location" : " · sorted by distance from your saved location") : " · set your location to sort by distance"
  }`;
  $("#s-list").innerHTML = res.length
    ? res.map((d) => donorCard(d, { distanceKm: d._d, exact: false })).join("")
    : emptyState("search", "No donors match", "Try widening the distance, including compatible groups, or clearing the city filter.");

  if (!searchMap) return;
  searchLayer.clearLayers();
  const pts = [];
  res.filter(hasCoords).forEach((d) => {
    L.marker([d.lat, d.lng], { icon: pin(d.bloodGroup, "donor") })
      .addTo(searchLayer)
      .bindPopup(
        `<strong>${esc(d.name)}</strong> · ${esc(d.bloodGroup)}<br>${esc(d.city || "")}<br>
         <button class="btn btn-primary btn-sm mt-2" data-action="request-donor" data-id="${esc(d.id)}">Send request</button>`
      );
    pts.push([d.lat, d.lng]);
  });
  if (hasCoords(ref)) {
    L.marker([ref.lat, ref.lng], { icon: pin("You", "me") }).addTo(searchLayer).bindPopup(usingGps ? "Your current location" : "Your saved location");
    pts.push([ref.lat, ref.lng]);
  }
  if (pts.length) searchMap.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
}

onSection("search", () => {
  if (!searchMap) {
    searchMap = createMap($("#s-map"));
    searchLayer = L.layerGroup().addTo(searchMap);
  }
  searchMap.invalidateSize();
  renderSearch();
});

["#s-group", "#s-radius", "#s-compat"].forEach((s) => $(s).addEventListener("change", renderSearch));
$("#s-city").addEventListener("input", debounce(renderSearch, 200));

$("#s-locate").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    ref = await geolocate();
    usingGps = true;
    renderSearch();
    toast("Using your current location for this search.", "info");
  } catch (err) {
    toast(err.message, "warning");
  } finally {
    btn.disabled = false;
  }
});

// quick group buttons on the overview
$("#quick-groups").innerHTML = BLOOD_GROUPS.map((g) => `<button class="btn btn-light blood-chip" data-qg="${esc(g)}" style="border-radius:12px">${esc(g)}</button>`).join("");
$("#quick-groups").addEventListener("click", (e) => {
  const b = e.target.closest("[data-qg]");
  if (!b) return;
  $("#s-group").value = b.dataset.qg;
  goTo("search");
});

// =====================================================================
//  NEW REQUEST
// =====================================================================
let reqPicker = null;
onSection("new-request", () => {
  if (!reqPicker) {
    reqPicker = wireLocationPicker("r", { lat: user.lat, lng: user.lng, toast });
    $("#r-contact").value ||= user.phone || "";
    $("#r-city").value ||= user.city || "";
    $("#r-by").value ||= addDaysISO(todayISO(), 1);
    $("#r-by").min = todayISO();
  }
  reqPicker.invalidate();
});

function setDirect(d) {
  direct = d;
  $("#direct-box").classList.toggle("d-none", !d);
  $("#direct-box").classList.toggle("d-flex", !!d);
  if (d) $("#direct-name").textContent = d.name;
}
$("#direct-clear").addEventListener("click", () => setDirect(null));

$("#request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const patient = $("#r-patient").value.trim();
  const group = $("#r-group").value;
  const units = Math.max(1, Math.min(10, parseInt($("#r-units").value, 10) || 1));
  const hospital = $("#r-hospital").value.trim();
  const city = $("#r-city").value.trim();
  const by = $("#r-by").value;
  const contact = $("#r-contact").value.trim();
  if (!patient || !group || !hospital || !city || !by) return toast("Please fill in all required fields.", "warning");
  if (!isPhone(contact)) return toast("Enter a valid contact number.", "warning");
  if (by < todayISO()) return toast("“Needed by” can't be in the past.", "warning");

  const loc = reqPicker?.get() || (hasCoords(user) ? { lat: user.lat, lng: user.lng } : null);
  const btn = $("#r-submit");
  setBusy(btn, true, "Sending…");
  try {
    const urgency = $('input[name="urgency"]:checked').value;
    await db.addDocument("requests", {
      receiverId: me.uid, receiverName: user.name, patientName: patient, bloodGroup: group, units, urgency,
      hospital, city, lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, contact, requiredBy: by,
      note: $("#r-note").value.trim(), status: "open", targetDonorId: direct?.id || "", targetDonorName: direct?.name || "",
      responses: {}, createdAt: Date.now(),
    });
    logActivity("request", `${user.name} posted a ${urgency} ${group} request in ${city}`, user);
    toast(direct ? `Request sent to ${direct.name}.` : "Request sent. Compatible donors are being alerted.");
    $("#request-form").reset();
    $("#r-contact").value = user.phone || "";
    $("#r-city").value = user.city || "";
    $("#r-by").value = addDaysISO(todayISO(), 1);
    setDirect(null);
    tab = "open";
    $$("#mr-tabs .nav-link").forEach((x) => x.classList.toggle("active", x.dataset.tab === "open"));
    goTo("my-requests");
  } catch (err) {
    toast(friendlyError(err), "danger");
  } finally {
    setBusy(btn, false);
  }
});

// =====================================================================
//  CLICK ACTIONS (cards + map popups)
// =====================================================================
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, id } = b.dataset;
  if (action === "fulfil") {
    if (await confirmDialog("Donors will no longer see this request.", { title: "Mark as fulfilled?", okText: "Yes, fulfilled" })) setStatus(id, "fulfilled", "Marked as fulfilled. Thank you to every donor!");
  } else if (action === "cancel") {
    if (await confirmDialog("Donors will no longer see this request.", { title: "Cancel this request?", okText: "Cancel request", danger: true })) setStatus(id, "cancelled", "Request cancelled.");
  } else if (action === "delete") {
    if (await confirmDialog("This permanently removes the request and its responses.", { title: "Delete request?", okText: "Delete", danger: true })) {
      try {
        await db.deleteDocument("requests", id);
        toast("Request deleted.", "info");
      } catch (err) {
        toast(friendlyError(err), "danger");
      }
    }
  } else if (action === "request-donor") {
    const d = donorIndex[id] || donors.find((x) => x.id === id);
    if (!d) return;
    setDirect({ id: d.uid || d.id, name: d.name });
    $("#r-group").value = $("#s-group").value || "";
    goTo("new-request");
    toast(`Fill in the details to send a request to ${d.name}.`, "info");
  }
});

// =====================================================================
//  NEARBY + PROFILE
// =====================================================================
const nearby = createNearby($("#sec-nearby"), () => ref);
let banks = [];
let camps = [];
db.subscribe("bloodBanks", (l) => ((banks = l), nearby.setData(banks, camps)));
db.subscribe("camps", (l) => ((camps = l), nearby.setData(banks, camps)));
onSection("nearby", () => nearby.refresh());

let profilePicker = null;
function fillProfile() {
  $("#p-name").value = user.name || "";
  $("#p-phone").value = user.phone || "";
  $("#p-email").value = user.email || me.email || "";
  $("#p-city").value = user.city || "";
  $("#p-photo-preview").innerHTML = user.photoURL ? `<img alt="" src="${esc(user.photoURL)}">` : '<i class="bi bi-person"></i>';
}
fillProfile();

onSection("profile", () => {
  if (!profilePicker) profilePicker = wireLocationPicker("p", { lat: user.lat, lng: user.lng, toast });
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
    const patch = { name, phone, city, photoURL, lat: loc ? loc.lat : user.lat ?? null, lng: loc ? loc.lng : user.lng ?? null };
    await db.updateDocument("users", me.uid, patch);
    user = { ...user, ...patch };
    if (!usingGps && hasCoords(user)) ref = { lat: user.lat, lng: user.lng };
    fillUserChrome(user);
    renderRequests();
    renderSearch();
    nearby.setData(banks, camps);
    toast("Profile updated.");
  } catch (err) {
    toast(friendlyError(err), "danger");
  } finally {
    setBusy(btn, false);
  }
});
