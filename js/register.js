import * as db from "./db.js";
import { BLOOD_GROUPS } from "./config.js";
import {
  $, $$, esc, toast, setBusy, friendlyError, dashFor, isEmail, isPhone, uploadImage,
  publicDonor, logActivity, injectDemoBadge, todayISO,
} from "./common.js";
import { wireLocationPicker } from "./map.js";

injectDemoBadge();
$("#yr").textContent = new Date().getFullYear();

const form = $("#reg-form");
$("#bloodGroup").innerHTML =
  '<option value="">Choose…</option>' + BLOOD_GROUPS.map((g) => `<option>${esc(g)}</option>`).join("");
$("#lastDonation").max = todayISO();

// ---------- role toggle ----------
const role = () => $('input[name="role"]:checked').value;
function applyRole() {
  const donor = role() === "donor";
  $$(".donor-only").forEach((el) => el.classList.toggle("d-none", !donor));
  $("#bloodGroup").required = donor;
}
$$('input[name="role"]').forEach((r) => r.addEventListener("change", applyRole));
const wanted = new URLSearchParams(location.search).get("role");
if (wanted === "receiver") $("#role-receiver").checked = true;
applyRole();

// ---------- map ----------
const pm = wireLocationPicker("reg", { toast });

// ---------- photo preview ----------
$("#photo").addEventListener("change", (e) => {
  const f = e.target.files[0];
  const box = $("#photo-preview");
  if (!f) return (box.innerHTML = '<i class="bi bi-person"></i>');
  if (!f.type.startsWith("image/")) {
    e.target.value = "";
    return toast("Please choose an image file.", "warning");
  }
  box.innerHTML = `<img alt="" src="${URL.createObjectURL(f)}">`;
});

// ---------- submit ----------
function validate() {
  const donor = role() === "donor";
  const checks = [
    ["name", $("#name").value.trim().length >= 2],
    ["phone", isPhone($("#phone").value)],
    ["email", isEmail($("#email").value)],
    ["password", $("#password").value.length >= 6],
    ["confirm", $("#confirm").value === $("#password").value && $("#confirm").value.length > 0],
    ["city", $("#city").value.trim().length > 0],
    ["terms", $("#terms").checked],
  ];
  if (donor) checks.push(["bloodGroup", !!$("#bloodGroup").value], ["adult", $("#adult").checked]);
  let ok = true;
  checks.forEach(([id, valid]) => {
    $(`#${id}`).classList.toggle("is-invalid", !valid);
    if (!valid) ok = false;
  });
  return ok;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) {
    toast("Please fix the highlighted fields.", "warning");
    return $(".is-invalid")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const btn = $("#submit");
  setBusy(btn, true, "Creating your account…");
  try {
    const r = role();
    const cred = await db.signUp($("#email").value.trim(), $("#password").value);

    let photoURL = "";
    try {
      photoURL = (await uploadImage($("#photo").files[0])) || "";
    } catch (err) {
      toast(err.message, "warning");
    }

    const loc = pm.get();
    const user = {
      uid: cred.uid,
      name: $("#name").value.trim(),
      email: $("#email").value.trim().toLowerCase(),
      phone: $("#phone").value.trim(),
      role: r,
      city: $("#city").value.trim(),
      bloodGroup: r === "donor" ? $("#bloodGroup").value : "",
      lat: loc ? loc.lat : null,
      lng: loc ? loc.lng : null,
      photoURL,
      blocked: false,
      createdAt: Date.now(),
      ...(r === "donor" ? { lastDonation: $("#lastDonation").value || "" } : {}),
    };

    await db.setDocument("users", cred.uid, user);
    if (r === "donor") await db.setDocument("donors", cred.uid, publicDonor(user, $("#available").checked));
    logActivity("register", `${user.name} registered as a ${r}`, user);

    toast("Account created. Welcome to LifeLink!");
    setTimeout(() => (location.href = dashFor(r)), 600);
  } catch (err) {
    console.error(err);
    toast(friendlyError(err), "danger");
    setBusy(btn, false);
  }
});
