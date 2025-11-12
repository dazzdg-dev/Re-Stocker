
# Re-Stocker — PWA (V1)

Installable, offline-first Progressive Web App to track home supplies.
Runs fully on-device (IndexedDB), no server, perfect for personal use.

## Features
- Add items (name, qty, unit, daily use, threshold)
- Auto-compute **days left**
- Low-stock **Shopping List** view
- Works **offline**, installable on Android/iOS via browser
- Local persistence (IndexedDB)

## How to run (local)
1. Download and unzip this project.
2. Serve it locally (any static server). Examples:
   - VS Code extension “Live Server”
   - Python: `python3 -m http.server 8080`
3. Open `http://localhost:8080` in Chrome → **Add to Home screen**

## Install on Android
- Open in Chrome → menu (⋮) → **Install app** or **Add to Home screen**.
- Optional: Tap **Enable Notifications** in the header.

## Notes
- Notifications in V1 are manual and only fire when the app is in use (no background scheduling).
- A JSON export/import tool and simple reminders are planned for V1.1.
