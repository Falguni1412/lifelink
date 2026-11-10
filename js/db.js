// Facade: pages import from here and get either the Firebase backend or the
// localStorage demo backend, chosen automatically from js/config.js.
import { DEMO_MODE } from "./config.js";

const impl = DEMO_MODE ? await import("./db-demo.js") : await import("./db-firebase.js");

export const {
  mode,
  onAuthChange,
  signUp,
  signIn,
  signOut,
  resetPassword,
  resetDemo,
  getDocument,
  listDocuments,
  setDocument,
  addDocument,
  updateDocument,
  deleteDocument,
  subscribe,
} = impl;
