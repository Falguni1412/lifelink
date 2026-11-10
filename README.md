# LifeLink – Smart Blood Donation & Emergency Connect Portal

A responsive, real-time blood donation platform built with **HTML5, CSS3, Bootstrap 5, vanilla JavaScript (ES modules), Firebase Authentication, Cloud Firestore, Cloudinary and Leaflet**. There is no PHP, Python or Node.js backend.

## Try it right now (Demo mode)

Until you add Firebase keys, LifeLink runs in **demo mode**: all data lives in your browser's `localStorage`, seeded with sample donors, requests, blood banks and camps.

```bash
cd lifelink
python3 -m http.server 8080      # any static server works; ES modules need http://, not file://
# open http://localhost:8080
```

| Role     | Email                  | Password      |
| -------- | ---------------------- | ------------- |
| Donor    | donor@lifelink.demo    | donor123      |
| Receiver | receiver@lifelink.demo | receiver123   |
| Admin    | admin@lifelink.demo    | admin123      |

Tip: open two windows (donor + receiver) and watch requests and responses sync live. The **Reset** link in the demo badge restores the sample data.

## Modules

| Module | Files |
| ------ | ----- |
| Modern homepage (live stats, map, camps, compatibility chart) | `index.html`, `js/home.js` |
| Registration & login (donor / receiver) | `register.html`, `login.html`, `js/register.js`, `js/login.js` |
| Donor dashboard: availability, accept/reject requests, donation history, profile | `donor-dashboard.html`, `js/donor.js` |
| Receiver dashboard: donor search by blood group/location, emergency requests, response tracking | `receiver-dashboard.html`, `js/receiver.js` |
| Nearby blood banks & camps map | `js/nearby.js`, `js/map.js` |
| Admin dashboard: donors, receivers, requests, blood banks, camps, activity | `admin-dashboard.html`, `js/admin.js` |

## Going live with Firebase

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method →** enable **Email/Password**.
3. **Firestore Database →** create a database (production mode).
4. **Project settings → Your apps → Web app →** copy the config into `firebaseConfig` in `js/config.js`. The app switches out of demo mode automatically.
5. **Firestore → Rules →** paste the contents of `firestore.rules` and publish (or `firebase deploy --only firestore:rules`).
6. **Authentication → Settings → Authorized domains:** add the domain you deploy to.

### Create your first admin

Admins cannot sign up from the website (by design). Register normally as a donor or receiver, then in the Firebase console open **Firestore → `users` → your user document** and change `role` to `admin`. Sign in again and you'll land on the admin dashboard.

### Cloudinary (profile photos)

1. Create a free account at <https://cloudinary.com>.
2. **Settings → Upload → Upload presets →** add an **unsigned** preset.
3. Put your cloud name and preset name in `cloudinaryConfig` in `js/config.js`.

Without Cloudinary, demo mode stores a small resized copy locally, and live mode simply skips the photo.

### Maps

Maps use **Leaflet + OpenStreetMap** (no API key). All map code is in `js/map.js`, so switching to Google Maps later only touches that file.

## Data model (Cloud Firestore)

| Collection | Purpose | Who can read |
| ---------- | ------- | ------------ |
| `users/{uid}` | Private profile: name, phone, role, exact location, `blocked` | owner, admin |
| `donors/{uid}` | Public donor card: name, group, city, location rounded to ~1 km, `available` | signed-in users |
| `requests/{id}` | Blood requests with `responses.{donorUid}` | signed-in users |
| `donations/{id}` | A donor's donation history | that donor, admin |
| `bloodBanks/{id}` | Banks with per-group `stock` | everyone |
| `camps/{id}` | Donation camps | everyone |
| `activity/{id}` | Platform activity log | admin |

## Privacy & safety notes

- Donor search uses the **public** `donors` card only; a donor's phone number is shared with a receiver only after the donor accepts that request.
- Coordinates in the public card are rounded to about 1 km.
- Every dynamic value is HTML-escaped before rendering.
- Donation eligibility rules (e.g. the 90-day gap) vary by country; the UI tells donors to confirm with their blood bank. LifeLink does not give medical advice.
- Removing a user in the admin dashboard deletes their LifeLink profile; the Firebase Authentication account must be deleted in the console (client apps cannot delete other users).
- The demo backend stores passwords in plain text in `localStorage`. It is for demonstration only.

## Project structure

```
index.html  login.html  register.html
donor-dashboard.html  receiver-dashboard.html  admin-dashboard.html
css/style.css
assets/logo.svg
js/
  config.js        Firebase + Cloudinary config, constants, blood compatibility
  db.js            picks db-firebase.js or db-demo.js automatically
  db-firebase.js   Firebase Auth + Firestore adapter
  db-demo.js       localStorage adapter with seed data
  common.js        auth guard, shell, toasts, dialogs, uploads, activity log
  components.js    card/badge HTML builders
  map.js nearby.js Leaflet helpers and the nearby banks/camps view
  home.js login.js register.js donor.js receiver.js admin.js
firestore.rules
```
