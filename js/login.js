import * as db from "./db.js";
import { DEMO_MODE, DEMO_ACCOUNTS } from "./config.js";
import { $, esc, toast, setBusy, friendlyError, dashFor, isEmail, injectDemoBadge } from "./common.js";

injectDemoBadge();
$("#yr").textContent = new Date().getFullYear();

const params = new URLSearchParams(location.search);
const notices = {
  blocked: "This account has been suspended by an administrator. Please contact support.",
  noprofile: "We couldn't find a LifeLink profile for this account. Please register again or contact support.",
};
if (notices[params.get("msg")]) {
  const n = $("#notice");
  n.textContent = notices[params.get("msg")];
  n.classList.remove("d-none");
}

// Only allow same-site relative redirects after login
function safeNext(role) {
  const next = params.get("next") || "";
  return /^[a-z-]+-dashboard\.html(#[a-z-]+)?$/i.test(next) && next.startsWith(dashFor(role)) ? next : dashFor(role);
}

// Already signed in? Skip the form.
db.onAuthChange(async (u) => {
  if (!u || $("#submit").disabled) return;
  try {
    const p = await db.getDocument("users", u.uid);
    if (p && !p.blocked) location.replace(safeNext(p.role));
  } catch {}
});

$("#toggle-pw").addEventListener("click", () => {
  const i = $("#password");
  const show = i.type === "password";
  i.type = show ? "text" : "password";
  $("#toggle-pw i").className = `bi bi-eye${show ? "-slash" : ""}`;
});

async function login(email, password) {
  const btn = $("#submit");
  setBusy(btn, true, "Logging in…");
  try {
    const u = await db.signIn(email, password);
    const profile = await db.getDocument("users", u.uid);
    if (!profile) {
      await db.signOut();
      throw new Error("No LifeLink profile found for this account.");
    }
    if (profile.blocked) {
      await db.signOut();
      throw new Error("This account has been suspended by an administrator.");
    }
    location.href = safeNext(profile.role);
  } catch (e) {
    toast(friendlyError(e), "danger");
    setBusy(btn, false);
  }
}

$("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("#email").value.trim();
  const pw = $("#password").value;
  $("#email").classList.toggle("is-invalid", !isEmail(email));
  if (!isEmail(email) || pw.length < 6) {
    if (pw.length < 6) toast("Password must be at least 6 characters.", "warning");
    return;
  }
  login(email, pw);
});

$("#forgot").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim();
  if (!isEmail(email)) return toast("Enter your email above first, then click “Forgot password”.", "warning");
  try {
    await db.resetPassword(email);
    toast(DEMO_MODE ? "Demo mode: no email is sent." : "If that email is registered, a reset link is on its way.", "info");
  } catch (err) {
    toast(friendlyError(err), "danger");
  }
});

if (DEMO_MODE) {
  $("#demo-box").classList.remove("d-none");
  $("#demo-accounts").innerHTML = DEMO_ACCOUNTS.map(
    (a, i) => `<div class="col-12 col-sm-4"><button type="button" class="demo-chip" data-i="${i}">
      <i class="bi bi-${esc(a.icon)} text-brand"></i><div class="fw-bold small">${esc(a.role)}</div>
      <div class="text-muted" style="font-size:.7rem">${esc(a.email)}</div></button></div>`
  ).join("");
  $("#demo-accounts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    const a = DEMO_ACCOUNTS[+b.dataset.i];
    $("#email").value = a.email;
    $("#password").value = a.password;
    login(a.email, a.password);
  });
}
