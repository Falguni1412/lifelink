// Shared browser helpers: auth guard, dashboard shell, toasts, dialogs, uploads.
import * as db from "./db.js";
import { DEMO_MODE, CLOUDINARY_READY, cloudinaryConfig } from "./config.js";
import { $, $$, esc, cap, avatarHtml } from "./utils.js";

export * from "./utils.js";

// ---------- routing ----------------------------------------------------
export const dashFor = (role) =>
  role === "admin" ? "admin-dashboard.html" : role === "receiver" ? "receiver-dashboard.html" : "donor-dashboard.html";

const halt = () => new Promise(() => {}); // stop the module while the browser redirects

// ---------- auth guard -------------------------------------------------
function firstAuthState() {
  return new Promise((resolve) => {
    let off = null;
    let done = false;
    off = db.onAuthChange((u) => {
      if (done) return;
      done = true;
      if (off) off();
      resolve(u);
    });
  });
}

export function hideLoader() {
  const el = $("#app-loader");
  if (el) {
    el.classList.add("done");
    setTimeout(() => el.remove(), 400);
  }
}

/**
 * Wait for Firebase/demo auth, load the profile, and make sure the signed-in
 * user has one of the allowed roles. Redirects otherwise.
 * Returns { uid, email, profile }.
 */
export async function requireRole(roles) {
  injectDemoBadge();
  const u = await firstAuthState();
  if (!u) {
    const here = location.pathname.split("/").pop() + location.hash;
    location.replace(`login.html?next=${encodeURIComponent(here)}`);
    await halt();
  }
  let profile = null;
  try {
    profile = await db.getDocument("users", u.uid);
  } catch (e) {
    console.error(e);
  }
  if (!profile) {
    await db.signOut();
    location.replace("login.html?msg=noprofile");
    await halt();
  }
  if (profile.blocked) {
    await db.signOut();
    location.replace("login.html?msg=blocked");
    await halt();
  }
  if (!roles.includes(profile.role)) {
    location.replace(dashFor(profile.role));
    await halt();
  }
  db.onAuthChange((nu) => {
    if (!nu) location.replace("index.html");
  });
  hideLoader();
  return { uid: u.uid, email: u.email, profile: { ...profile, id: u.uid } };
}

// ---------- dashboard shell -------------------------------------------
let currentSection = null;

export function initShell(defaultSection) {
  const show = (id) => {
    const target = $(`#sec-${id}`) ? id : defaultSection;
    $$(".dash-section").forEach((s) => s.classList.toggle("d-none", s.id !== `sec-${target}`));
    $$("[data-section]").forEach((a) => a.classList.toggle("active", a.dataset.section === target));
    const link = $(`.sidebar [data-section="${target}"]`);
    const title = $("#page-title");
    if (title && link) title.textContent = link.dataset.title || link.textContent.trim();
    document.body.classList.remove("sidebar-open");
    window.scrollTo(0, 0);
    currentSection = target;
    window.dispatchEvent(new CustomEvent("ll:section", { detail: target }));
  };
  window.addEventListener("hashchange", () => show(location.hash.slice(1) || defaultSection));
  show(location.hash.slice(1) || defaultSection);

  $("#menu-toggle")?.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  $("#sidebar-backdrop")?.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  $$(".js-logout").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      await db.signOut();
      location.href = "index.html";
    })
  );
}

export const goTo = (id) => {
  if (location.hash.slice(1) === id) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = id;
};

/** Run fn when a dashboard section becomes visible (e.g. to size Leaflet maps). */
export const onSection = (id, fn) => {
  window.addEventListener("ll:section", (e) => e.detail === id && fn());
  // the section may already be showing (deep link such as #profile)
  if (currentSection === id) Promise.resolve().then(fn);
};

export function fillUserChrome(profile) {
  $$(".js-user-name").forEach((e) => (e.textContent = profile.name || "User"));
  $$(".js-user-role").forEach((e) => (e.textContent = cap(profile.role)));
  $$(".js-user-avatar").forEach((e) => (e.innerHTML = avatarHtml(profile, e.dataset.size ? +e.dataset.size : 40)));
}

// ---------- feedback ---------------------------------------------------
export function toast(message, type = "success") {
  let box = $("#toast-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-box";
    box.className = "toast-container position-fixed top-0 end-0 p-3";
    box.style.zIndex = 2000;
    document.body.appendChild(box);
  }
  const icon =
    { success: "check-circle-fill", danger: "exclamation-octagon-fill", warning: "exclamation-triangle-fill", info: "info-circle-fill" }[type] ||
    "info-circle-fill";
  const el = document.createElement("div");
  el.className = `toast ll-toast ll-toast-${type} align-items-center border-0`;
  el.setAttribute("role", "alert");
  el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi bi-${icon} me-2"></i>${esc(message)}</div>
    <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  box.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: type === "danger" ? 6000 : 4000 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  t.show();
}

export function confirmDialog(message, { title = "Are you sure?", okText = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.tabIndex = -1;
    wrap.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow">
      <div class="modal-body p-4 text-center">
        <div class="confirm-icon ${danger ? "danger" : ""}"><i class="bi bi-${danger ? "trash3" : "question-lg"}"></i></div>
        <h2 class="h5 fw-bold">${esc(title)}</h2>
        <p class="text-muted mb-4">${esc(message)}</p>
        <div class="d-flex gap-2 justify-content-center">
          <button class="btn btn-light px-4" data-bs-dismiss="modal">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} px-4" data-ok>${esc(okText)}</button>
        </div></div></div></div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap);
    let result = false;
    $("[data-ok]", wrap).addEventListener("click", () => {
      result = true;
      modal.hide();
    });
    wrap.addEventListener("hidden.bs.modal", () => {
      wrap.remove();
      resolve(result);
    });
    modal.show();
  });
}

export function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${esc(text || "Please wait…")}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
  }
}

const AUTH_MESSAGES = {
  "auth/email-already-in-use": "An account with this email already exists. Try logging in instead.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "No account found with this email.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "permission-denied": "Permission denied. Check your Firestore security rules (see README).",
};
export const friendlyError = (e) => AUTH_MESSAGES[e?.code] || e?.message || "Something went wrong. Please try again.";

// ---------- uploads ----------------------------------------------------
function resizeToDataUrl(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = url;
  });
}

/** Upload a profile photo. Cloudinary when configured, a local copy in demo mode. */
export async function uploadImage(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be smaller than 5 MB.");
  if (CLOUDINARY_READY) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", cloudinaryConfig.uploadPreset);
    fd.append("folder", "lifelink/profiles");
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`, { method: "POST", body: fd });
    if (!res.ok) throw new Error("Photo upload failed. Check your Cloudinary cloud name and unsigned upload preset.");
    return (await res.json()).secure_url;
  }
  if (DEMO_MODE) return resizeToDataUrl(file, 256);
  throw new Error("Cloudinary isn't configured yet (js/config.js), so the photo was skipped.");
}

// ---------- activity log ----------------------------------------------
export async function logActivity(type, text, actor) {
  try {
    await db.addDocument("activity", {
      type,
      text,
      actorId: actor?.uid || "",
      actorName: actor?.name || "",
      createdAt: Date.now(),
    });
  } catch (e) {
    console.warn("Could not write activity log", e);
  }
}

// ---------- demo badge -------------------------------------------------
export function injectDemoBadge() {
  if (!DEMO_MODE || $("#demo-badge")) return;
  const el = document.createElement("div");
  el.id = "demo-badge";
  el.className = "demo-badge";
  el.innerHTML = `<i class="bi bi-flask me-1"></i> Demo mode · data stays in this browser
    <button type="button" class="btn btn-link btn-sm p-0 ms-2" id="demo-reset">Reset</button>`;
  document.body.appendChild(el);
  $("#demo-reset", el).addEventListener("click", async () => {
    if (await confirmDialog("This clears all demo data in this browser and restores the sample data.", { title: "Reset demo data?", okText: "Reset", danger: true })) {
      db.resetDemo();
      location.href = "index.html";
    }
  });
}

/** Ask the browser for notification permission-free alert sound? No - keep it simple. */
export const urgencyRank = { critical: 0, urgent: 1, normal: 2 };
