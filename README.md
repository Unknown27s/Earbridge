# Earbridge — Phone Bluetooth Audio Proxy

Stream your PC's audio to your phone over WiFi, and play it through Bluetooth
headphones paired with the phone. The PC's browser page captures system audio;
the phone page receives WebRTC audio and outputs it to whichever audio device
Android routes to (Bluetooth headphones, speaker, earpiece).

## How it works

```
PC browser (sender.html)  ──WebRTC/Opus──▶  Phone browser/APK (receiver.html)  ──▶ BT headphones
        │                                        │
        └──── PeerJS signalling (port 3000) ─────┘
        └──── Control WS (port 3001): stop, status
```

- `server.js` — Express + PeerServer + control WebSocket server
- `client/` — React + Vite + Tailwind + framer-motion UI (two pages: sender, receiver)
- `android/` — Capacitor wrapper → builds the Earbridge APK

## Run locally (PC)

```bash
npm install
cd client && npm install && npm run build && cd ..
node server.js
```

Open:
- PC: `http://localhost:3000/sender.html`
- Phone (same WiFi): `http://<PC-IP>:3000/receiver.html` — enter the peer ID from the QR/chip on the sender page, or let it auto-discover via `/sender-id`

## Configuration

The phone remembers the server URL in `localStorage` (`earbridge_server`).
To change the PC's IP, just edit the server field in the receiver UI. No rebuild needed.

## Build the APK (GitHub Actions)

1. Push this repo to GitHub.
2. `.github/workflows/build-apk.yml` builds the debug APK on every push:
   `npm install` → `client` build → `npx cap sync android` → `./gradlew assembleDebug`.
3. Download `earbridge-debug-apk` from the Actions run artifacts and install it.

## Local APK build (if you have the Android SDK)

```bash
cd client && npm run build && cd ..
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```
