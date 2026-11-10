// =====================================================================
//  DEMO adapter - same interface as db-firebase.js, but everything is
//  stored in localStorage. Used automatically until Firebase keys are set.
//  Open two browser windows to watch "real-time" updates sync across tabs.
//  NOTE: passwords are stored in plain text here. Demo use only.
// =====================================================================

export const mode = "demo";

const KEY = "lifelink_demo_db_v1";
const SESSION = "lifelink_demo_session_v1";

const subs = new Set(); // { col, cb, opts }
const authSubs = new Set();
let cache = null;

const clone = (x) => JSON.parse(JSON.stringify(x));
const rid = (p = "d") => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

function err(code, message) {
  return Object.assign(new Error(message || code), { code });
}

// ---------- storage ----------------------------------------------------
function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(cache));
}
function data() {
  if (!cache) {
    cache = load();
    if (!cache) {
      cache = seed();
      persist();
    }
  }
  return cache;
}
const table = (name) => (data()[name] ||= {});

// ---------- query helpers ---------------------------------------------
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k) => {
    if (typeof o[k] !== "object" || o[k] === null) o[k] = {};
    o = o[k];
  });
  o[keys[keys.length - 1]] = value;
}

function matches(doc, where = []) {
  return where.every(([field, op, val]) => {
    const x = getPath(doc, field);
    switch (op) {
      case "==": return x === val;
      case "!=": return x !== val;
      case "in": return Array.isArray(val) && val.includes(x);
      case "array-contains": return Array.isArray(x) && x.includes(val);
      case ">=": return x >= val;
      case "<=": return x <= val;
      default: return true;
    }
  });
}

function snapshot(col, opts) {
  return Object.entries(table(col))
    .filter(([, d]) => matches(d, opts?.where))
    .map(([id, d]) => ({ id, ...clone(d) }));
}

function notify(col) {
  subs.forEach((s) => {
    if (s.col === col) s.cb(snapshot(s.col, s.opts));
  });
}
const notifyAll = () => new Set([...subs].map((s) => s.col)).forEach(notify);

// Cross-tab sync: another tab changed the data / the session.
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    cache = null;
    notifyAll();
  }
  if (e.key === SESSION) authSubs.forEach((cb) => cb(currentUser()));
});

// ---------- auth -------------------------------------------------------
function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(SESSION));
  } catch {
    return null;
  }
}
function setSession(u) {
  if (u) localStorage.setItem(SESSION, JSON.stringify(u));
  else localStorage.removeItem(SESSION);
  authSubs.forEach((cb) => cb(u));
}

export function onAuthChange(cb) {
  authSubs.add(cb);
  Promise.resolve().then(() => authSubs.has(cb) && cb(currentUser()));
  return () => authSubs.delete(cb);
}

export async function signUp(email, password) {
  email = String(email).trim().toLowerCase();
  if (String(password).length < 6) throw err("auth/weak-password");
  const a = (data()._auth ||= {});
  if (a[email]) throw err("auth/email-already-in-use");
  const uid = rid("u");
  a[email] = { uid, password };
  persist();
  const user = { uid, email };
  setSession(user);
  return user;
}

export async function signIn(email, password) {
  email = String(email).trim().toLowerCase();
  const rec = data()._auth?.[email];
  if (!rec || rec.password !== password) throw err("auth/invalid-credential");
  const user = { uid: rec.uid, email };
  setSession(user);
  return user;
}

export async function signOut() {
  setSession(null);
}

export async function resetPassword() {
  return true; // nothing to send in demo mode
}

export function resetDemo() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SESSION);
  cache = null;
}

// ---------- documents --------------------------------------------------
export async function getDocument(col, id) {
  const d = table(col)[id];
  return d ? { id, ...clone(d) } : null;
}

export async function listDocuments(col, opts) {
  return snapshot(col, opts);
}

export async function setDocument(col, id, value, { merge = false } = {}) {
  const t = table(col);
  const { id: _ignore, ...rest } = clone(value);
  t[id] = merge ? { ...(t[id] || {}), ...rest } : rest;
  persist();
  notify(col);
  return id;
}

export async function addDocument(col, value) {
  const id = rid(col.slice(0, 3));
  return setDocument(col, id, value);
}

/** Supports dot-paths like "responses.<uid>" just like Firestore. */
export async function updateDocument(col, id, patch) {
  const t = table(col);
  if (!t[id]) throw err("not-found", "Document does not exist");
  Object.entries(patch).forEach(([k, v]) => setPath(t[id], k, clone(v)));
  persist();
  notify(col);
}

export async function deleteDocument(col, id) {
  delete table(col)[id];
  persist();
  notify(col);
}

export function subscribe(col, cb, opts) {
  const s = { col, cb, opts };
  subs.add(s);
  Promise.resolve().then(() => subs.has(s) && cb(snapshot(col, opts)));
  return () => subs.delete(s);
}

// ---------- seed data --------------------------------------------------
function seed() {
  const now = Date.now();
  const DAY = 86400000;
  const iso = (offset) => {
    const d = new Date(now + offset * DAY);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const db = { users: {}, donors: {}, requests: {}, donations: {}, bloodBanks: {}, camps: {}, activity: {}, _auth: {} };

  const city = {
    Amravati: [20.932, 77.7523],
    Nagpur: [21.1458, 79.0882],
    Akola: [20.7002, 77.0082],
    Pune: [18.5204, 73.8567],
    Mumbai: [19.076, 72.8777],
    Aurangabad: [19.8762, 75.3433],
  };
  const jitter = (n, k) => ((((n * 9301 + k * 49297) % 233280) / 233280) - 0.5) * 0.08;

  // --- people with sign-in
  const login = [
    ["u_admin", "Demo Admin", "admin", "admin@lifelink.demo", "admin123", "Amravati", ""],
    ["u_donor_demo", "Demo Donor", "donor", "donor@lifelink.demo", "donor123", "Amravati", "O+"],
    ["u_receiver_demo", "Demo Receiver", "receiver", "receiver@lifelink.demo", "receiver123", "Nagpur", ""],
  ];
  login.forEach(([uid, name, role, email, password, c, bg], i) => {
    const [lat, lng] = city[c];
    db.users[uid] = {
      uid, name, role, email, phone: `+91 90000 0000${i + 1}`, city: c, bloodGroup: bg,
      lat: lat + jitter(i + 1, 1), lng: lng + jitter(i + 1, 2), photoURL: "", blocked: false,
      createdAt: now - (30 - i) * DAY, ...(role === "donor" ? { lastDonation: iso(-45) } : {}), seed: true,
    };
    db._auth[email] = { uid, password };
  });
  const dd = db.users.u_donor_demo;
  db.donors.u_donor_demo = {
    uid: "u_donor_demo", name: dd.name, bloodGroup: "O+", city: dd.city,
    lat: Math.round(dd.lat * 100) / 100, lng: Math.round(dd.lng * 100) / 100,
    available: true, photoURL: "", createdAt: dd.createdAt,
  };

  // --- seeded donors (no sign-in)
  const donors = [
    ["Aarav Deshmukh", "O+", "Amravati", true], ["Isha Kulkarni", "A+", "Amravati", true],
    ["Rohan Bhosale", "B+", "Nagpur", true], ["Sneha Joshi", "AB+", "Nagpur", false],
    ["Kabir Shaikh", "O-", "Akola", true], ["Meera Patil", "B-", "Pune", true],
    ["Vihaan More", "A-", "Pune", true], ["Anaya Gawande", "O+", "Mumbai", true],
    ["Dev Thakre", "B+", "Amravati", true], ["Tanvi Raut", "AB-", "Nagpur", true],
    ["Arjun Wankhede", "A+", "Akola", false], ["Pooja Ingle", "O+", "Aurangabad", true],
    ["Yash Chavan", "B+", "Mumbai", true], ["Riya Sawant", "A+", "Pune", true],
  ];
  donors.forEach(([name, bg, c, available], i) => {
    const uid = `u_seed_d${i + 1}`;
    const [lat, lng] = city[c];
    const la = lat + jitter(i + 5, 3), ln = lng + jitter(i + 5, 4);
    db.users[uid] = {
      uid, name, role: "donor", email: `donor${i + 1}@seed.lifelink.demo`, phone: `+91 91000 000${String(i + 10)}`,
      city: c, bloodGroup: bg, lat: la, lng: ln, photoURL: "", blocked: false,
      lastDonation: iso(-(60 + i * 13)), createdAt: now - (20 - (i % 15)) * DAY, seed: true,
    };
    db.donors[uid] = {
      uid, name, bloodGroup: bg, city: c, lat: Math.round(la * 100) / 100, lng: Math.round(ln * 100) / 100,
      available, photoURL: "", createdAt: db.users[uid].createdAt,
    };
  });

  // --- a second receiver
  db.users.u_seed_r1 = {
    uid: "u_seed_r1", name: "Seed Receiver", role: "receiver", email: "receiver1@seed.lifelink.demo",
    phone: "+91 92000 00001", city: "Amravati", bloodGroup: "", lat: 20.94, lng: 77.76, photoURL: "",
    blocked: false, createdAt: now - 12 * DAY, seed: true,
  };

  // --- blood banks
  const stock = (a) => Object.fromEntries(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((g, i) => [g, a[i]]));
  const banks = [
    ["Central City Blood Bank", "Amravati", "Station Road, Amravati", "+91 721 000 0001", "24 hours", 20.9374, 77.7796, [14, 2, 11, 0, 4, 1, 18, 3]],
    ["Riverside Community Blood Centre", "Nagpur", "Civil Lines, Nagpur", "+91 712 000 0002", "8 AM - 8 PM", 21.1498, 79.0806, [9, 0, 7, 2, 3, 0, 12, 1]],
    ["Lakeview Hospital Blood Bank", "Akola", "Tower Chowk, Akola", "+91 724 000 0003", "24 hours", 20.7096, 77.0027, [5, 1, 6, 0, 2, 0, 8, 0]],
    ["Heritage Blood Storage Unit", "Pune", "Shivajinagar, Pune", "+91 20 0000 0004", "9 AM - 7 PM", 18.5308, 73.8475, [20, 4, 16, 3, 6, 2, 25, 5]],
    ["Harbour Blood Services", "Mumbai", "Parel, Mumbai", "+91 22 0000 0005", "24 hours", 19.0017, 72.8408, [30, 6, 22, 4, 9, 3, 34, 7]],
    ["Marathwada Regional Blood Bank", "Aurangabad", "Cidco, Aurangabad", "+91 240 000 0006", "9 AM - 6 PM", 19.8913, 75.3601, [8, 1, 9, 1, 2, 0, 10, 2]],
  ];
  banks.forEach(([name, c, address, phone, hours, lat, lng, s], i) => {
    db.bloodBanks[`bnk_seed${i + 1}`] = { name, city: c, address, phone, hours, lat, lng, stock: stock(s), createdAt: now - 25 * DAY };
  });

  // --- donation camps
  const camps = [
    ["Community Blood Donation Drive", "Rotary-style Service Club", 3, "09:00 - 15:00", "Town Hall Grounds", "Amravati", 20.9419, 77.7561, "Open to all healthy adults. Refreshments provided."],
    ["Campus Donation Camp", "Student Volunteers Forum", 9, "10:00 - 16:00", "College Auditorium", "Nagpur", 21.1389, 79.0647, "Bring a photo ID. Eat well before donating."],
    ["Weekend Mega Camp", "Lifeline Volunteers", 16, "08:30 - 14:00", "City Sports Complex", "Pune", 18.5167, 73.8562, "Walk-ins welcome; pre-register to skip the queue."],
    ["Festival of Giving", "Neighbourhood Association", 30, "10:00 - 17:00", "Community Hall", "Akola", 20.7035, 77.0136, "Family-friendly event with a health check-up desk."],
  ];
  camps.forEach(([title, organizer, off, time, venue, c, lat, lng, description], i) => {
    db.camps[`cmp_seed${i + 1}`] = { title, organizer, date: iso(off), time, venue, city: c, lat, lng, contact: `+91 93000 0000${i + 1}`, description, createdAt: now - 10 * DAY };
  });

  // --- requests
  const rq = (o) => ({ responses: {}, status: "open", targetDonorId: "", createdAt: now, ...o });
  db.requests.req_seed1 = rq({
    receiverId: "u_receiver_demo", receiverName: "Demo Receiver", patientName: "Patient A", bloodGroup: "B+", units: 2,
    urgency: "critical", hospital: "Lifeline General Hospital", city: "Nagpur", lat: 21.1511, lng: 79.0934,
    contact: "+91 90000 00003", requiredBy: iso(1), note: "Surgery scheduled tomorrow morning. Two units needed.",
    createdAt: now - 3 * 3600000,
    responses: {
      u_seed_d3: { status: "accepted", name: "Rohan Bhosale", phone: "+91 91000 00012", city: "Nagpur", bloodGroup: "B+", at: now - 2 * 3600000 },
      u_seed_d9: { status: "accepted", name: "Dev Thakre", phone: "+91 91000 00018", city: "Amravati", bloodGroup: "B+", at: now - 3600000 },
      u_seed_d6: { status: "declined", name: "Meera Patil", at: now - 3000000 },
    },
  });
  db.requests.req_seed2 = rq({
    receiverId: "u_receiver_demo", receiverName: "Demo Receiver", patientName: "Patient B", bloodGroup: "O-", units: 1,
    urgency: "normal", hospital: "Riverside Care Clinic", city: "Nagpur", lat: 21.14, lng: 79.09, contact: "+91 90000 00003",
    requiredBy: iso(-6), note: "", status: "fulfilled", fulfilledAt: now - 5 * DAY, createdAt: now - 8 * DAY,
    responses: { u_seed_d5: { status: "accepted", name: "Kabir Shaikh", phone: "+91 91000 00014", city: "Akola", bloodGroup: "O-", at: now - 7 * DAY } },
  });
  db.requests.req_seed3 = rq({
    receiverId: "u_seed_r1", receiverName: "Seed Receiver", patientName: "Patient C", bloodGroup: "O+", units: 3,
    urgency: "urgent", hospital: "Amravati District Hospital", city: "Amravati", lat: 20.9333, lng: 77.7488,
    contact: "+91 92000 00001", requiredBy: iso(2), note: "Accident case; units needed within 48 hours.", createdAt: now - 5 * 3600000,
  });
  db.requests.req_seed4 = rq({
    receiverId: "u_seed_r1", receiverName: "Seed Receiver", patientName: "Patient D", bloodGroup: "A+", units: 1,
    urgency: "normal", hospital: "Akola Medical Centre", city: "Akola", lat: 20.7054, lng: 77.0105,
    contact: "+91 92000 00001", requiredBy: iso(5), note: "Planned procedure next week.", createdAt: now - DAY,
  });
  db.requests.req_seed5 = rq({
    receiverId: "u_seed_r1", receiverName: "Seed Receiver", patientName: "Patient E", bloodGroup: "AB+", units: 2,
    urgency: "critical", hospital: "Pune Heart Institute", city: "Pune", lat: 18.5246, lng: 73.8786,
    contact: "+91 92000 00001", requiredBy: iso(1), note: "ICU patient.", createdAt: now - 2 * 3600000,
  });

  // --- donation history for the demo donor
  [[-45, "Central City Blood Bank", "Regular donation"], [-170, "Community Blood Donation Drive", "Camp donation"], [-300, "Central City Blood Bank", ""]].forEach(([o, location, note], i) => {
    db.donations[`don_seed${i + 1}`] = { donorId: "u_donor_demo", donorName: "Demo Donor", requestId: null, bloodGroup: "O+", date: iso(o), location, units: 1, note, createdAt: now + o * DAY };
  });

  // --- activity
  [
    ["register", "Seed Receiver registered as a receiver", "u_seed_r1", "Seed Receiver", 12 * DAY],
    ["request", "Demo Receiver posted a critical B+ request in Nagpur", "u_receiver_demo", "Demo Receiver", 3 * 3600000],
    ["response", "Rohan Bhosale accepted a B+ request", "u_seed_d3", "Rohan Bhosale", 2 * 3600000],
    ["request", "Seed Receiver posted a critical AB+ request in Pune", "u_seed_r1", "Seed Receiver", 2 * 3600000],
  ].forEach(([type, text, actorId, actorName, ago], i) => {
    db.activity[`act_seed${i + 1}`] = { type, text, actorId, actorName, createdAt: now - ago };
  });

  return db;
}
