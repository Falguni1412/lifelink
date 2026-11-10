// =====================================================================
//  LifeLink configuration
//  1. Paste your Firebase web-app config below (Firebase console ->
//     Project settings -> Your apps -> Web app).
//  2. (Optional) Add your Cloudinary cloud name + an UNSIGNED upload preset
//     for profile photos.
//  Until real Firebase keys are added, LifeLink runs in DEMO MODE: all data
//  lives in this browser's localStorage and demo accounts are available.
// =====================================================================


export const firebaseConfig = {
  apiKey: "AIzaSyA3qsDOCxAV2Lx1WW1aoQS0sTQkF-myUf8",
  authDomain: "loginapp-firebase-f5522.firebaseapp.com",
  projectId: "loginapp-firebase-f5522",
  storageBucket: "loginapp-firebase-f5522.firebasestorage.app",
  messagingSenderId: "946470012518",
  appId: "1:946470012518:web:278ce2e21ad4c0fc754fa7",
  measurementId: "G-0N4DMT9FKL"
};



export const cloudinaryConfig = {
  cloudName: "pkxyjihf",
  uploadPreset: "lifelink_unsigned",
};
// ---- derived flags (do not edit) ------------------------------------
export const DEMO_MODE =
  !firebaseConfig.apiKey || String(firebaseConfig.apiKey).startsWith("YOUR_");

export const CLOUDINARY_READY =
  !!cloudinaryConfig.cloudName &&
  !String(cloudinaryConfig.cloudName).startsWith("YOUR_") &&
  !!cloudinaryConfig.uploadPreset &&
  !String(cloudinaryConfig.uploadPreset).startsWith("YOUR_");

// ---- app constants ---------------------------------------------------
export const MAP_DEFAULT = { lat: 20.5937, lng: 78.9629, zoom: 5 }; // India

// Approximate gap between whole-blood donations. Rules differ by country,
// so the UI always tells donors to confirm with their blood bank.
export const DONATION_GAP_DAYS = 90;

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Red-cell compatibility: recipient group -> donor groups that can give to it
export const CAN_RECEIVE_FROM = {
  "O-": ["O-"],
  "O+": ["O+", "O-"],
  "A-": ["A-", "O-"],
  "A+": ["A+", "A-", "O+", "O-"],
  "B-": ["B-", "O-"],
  "B+": ["B+", "B-", "O+", "O-"],
  "AB-": ["AB-", "A-", "B-", "O-"],
  "AB+": ["AB+", "AB-", "A+", "A-", "B+", "B-", "O+", "O-"],
};

// donor group -> recipient groups they can give to
export const CAN_DONATE_TO = Object.fromEntries(
  BLOOD_GROUPS.map((g) => [
    g,
    BLOOD_GROUPS.filter((r) => CAN_RECEIVE_FROM[r].includes(g)),
  ])
);

// Shown on the login page in demo mode only
export const DEMO_ACCOUNTS = [
  { role: "Donor", email: "donor@lifelink.demo", password: "donor123", icon: "droplet-half" },
  { role: "Receiver", email: "receiver@lifelink.demo", password: "receiver123", icon: "person-heart" },
  { role: "Admin", email: "admin@lifelink.demo", password: "admin123", icon: "shield-check" },
];
