// =====================================================================
//  Firebase adapter: Authentication + Cloud Firestore (modular SDK via CDN).
//  Same interface as db-demo.js, so the pages never know the difference.
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export const mode = "firebase";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);

const plain = (u) => (u ? { uid: u.uid, email: u.email } : null);

// Firestore rejects `undefined` values, so strip them before every write.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)])
    );
  }
  return v;
}

// ---------- auth -------------------------------------------------------
export const onAuthChange = (cb) => onAuthStateChanged(auth, (u) => cb(plain(u)));

export async function signUp(email, password) {
  const c = await createUserWithEmailAndPassword(auth, email.trim(), password);
  return plain(c.user);
}
export async function signIn(email, password) {
  const c = await signInWithEmailAndPassword(auth, email.trim(), password);
  return plain(c.user);
}
export const signOut = () => fbSignOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());
export const resetDemo = () => {};

// ---------- firestore --------------------------------------------------
// Only simple equality filters are used, so no composite indexes are needed.
// Sorting is done in the browser.
function buildQuery(col, opts) {
  const base = collection(fs, col);
  const filters = (opts?.where || []).map(([f, op, v]) => where(f, op, v));
  return filters.length ? query(base, ...filters) : base;
}
const unpack = (d) => ({ id: d.id, ...d.data() });

export async function getDocument(col, id) {
  const s = await getDoc(doc(fs, col, id));
  return s.exists() ? unpack(s) : null;
}

export async function listDocuments(col, opts) {
  const s = await getDocs(buildQuery(col, opts));
  return s.docs.map(unpack);
}

export async function setDocument(col, id, value, { merge = false } = {}) {
  const { id: _ignore, ...rest } = value;
  await setDoc(doc(fs, col, id), clean(rest), { merge });
  return id;
}

export async function addDocument(col, value) {
  const { id: _ignore, ...rest } = value;
  const ref = await addDoc(collection(fs, col), clean(rest));
  return ref.id;
}

/** Keys may be dot-paths, e.g. { "responses.<uid>": {...} } */
export const updateDocument = (col, id, patch) => updateDoc(doc(fs, col, id), clean(patch));
export const deleteDocument = (col, id) => deleteDoc(doc(fs, col, id));

export function subscribe(col, cb, opts, onError) {
  return onSnapshot(
    buildQuery(col, opts),
    (snap) => cb(snap.docs.map(unpack)),
    (e) => {
      console.error(`[LifeLink] listener on "${col}" failed:`, e);
      onError?.(e);
    }
  );
}
