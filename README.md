# Earbridge — Phone Bluetooth Audio Proxy

Stream your PC's audio to your phone over WiFi, and play it through Bluetooth
headphones paired with the phone. The PC's browser page captures system audio;
the phone page receives WebRTC audio and outputs it to whichever audio device
Android routes to (Bluetooth headphones, speaker, earpiece).

## How it works

```
PC browser (sender.html)  ──WebRTC/Opus──▶  Phone browser/APK (receiver.html)  ──▶ BT headphones
        │                                        │
        └──── PeerJS signalling (same port) ─────┘
        └──── Control WS (same port, /control): stop, status
```

Audio is peer-to-peer. The server only carries the WebRTC handshake and the
control channel, so it stays near-idle and stays cheap to host — and a stream
that is already running survives the server going away.

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

The receiver resolves which server to talk to in this order:

1. `localStorage.earbridge_server` — whatever the user typed in the UI
2. `<meta name="earbridge-server">` — baked in at build time from `EARBRIDGE_SERVER`
3. `location.origin` — correct for a phone browser opened from the hosted page

Step 2 exists because `location.origin` inside the Capacitor WebView is always
`https://localhost`, so an APK without it cannot reach a hosted server at all.

## Deploy to Render

Fastest path: the repo now contains `render.yaml`, so
`render blueprint launch` (or **New → Blueprint** in the dashboard) fills every
field for you. To do it by hand instead:

| Field | Value |
|---|---|
| Type | Web Service |
| Build command | `npm install && npm run build:client` |
| Start command | `npm start` |
| Health check path | `/healthz` |

`client/dist` is gitignored, so the build command has to compile the web client —
Render cannot start from source alone.

Verify once it is up:

```bash
curl https://<your-service>.onrender.com/healthz
# {"ok":true,"uptime":12,"sender":null}
```

Then open `https://<your-service>.onrender.com/sender.html` on the PC.

### Keeping it awake

Render free instances sleep after 15 minutes without inbound traffic, which costs
a 30–50 s cold start on the next connection. Two options:

- **Free:** add the repo secret `RENDER_PING_URL` (`https://<service>.onrender.com`).
  `.github/workflows/keepalive.yml` pings `/healthz` every 10 minutes, which keeps
  the instance warm at ~720 of the 750 free instance-hours/month. GitHub disables
  scheduled workflows on repos with no activity for 60 days — if the instance
  sleeps, run the workflow manually once via `workflow_dispatch`.
- **$7/mo Starter:** never sleeps, and the keepalive workflow is unnecessary.

The control channel already heartbeats every 30 s and reconnects with backoff, so
a dropped proxy socket or a mid-session instance restart recovers on its own.

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Set by Render. The control channel shares this port — Render exposes no others. |
| `RENDER_EXTERNAL_URL` | Set by Render. Used to build the QR code and receiver URL. Falls back to `X-Forwarded-Proto`/`X-Forwarded-Host`, then the request origin. |
| `PUBLIC_ORIGIN` | Optional override, wins over `RENDER_EXTERNAL_URL`. |
| `TURN_URL` | Comma-separated TURN relay URLs. **Set this for reliable internet use** (see below). |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | TURN credentials, if your relay requires them. |

### TURN, and why it matters

On a LAN both devices share a subnet, so NAT never comes up. Across the internet
that changes: if either side sits behind symmetric NAT — common on mobile carriers
and some office WiFi — the direct path fails and no audio connects. STUN alone
cannot fix this; only a TURN relay can.

Without `TURN_URL` the app still works for most home/office connections and fails
silently for the rest. With `TURN_URL` set it is served to clients from `/ice-servers`
and PeerJS is constructed with it. Note that TURN relays media, so it costs real
bandwidth and adds ~100–200 ms of latency to sessions that need it.

**Always include a `turns:` entry on port 443.** Plenty of hotel and corporate
networks block UDP outright; TLS on 443 is usually the only thing that gets
through, and those are precisely the networks that otherwise fail silently. A
UDP-only TURN will not save you there.

Verified end to end: `TURN_URL` → `/ice-servers` → shipped `receiver.html` →
`peerOpts()` → PeerJS, with `turns:…:443?transport=tcp` preserved.

#### Self-hosted coturn (recommended)

Cheapest way to be genuinely reliable, and no third party sees your audio. You
need a host with a public IP and ports forwarded. On a small VPS:

```yaml
# docker-compose.yml
services:
  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
      - ./turn-cert:/etc/coturn/certs:ro
```

```
# turnserver.conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
user=earbridge:PASSWORD
realm=turn.example.com
external-ip=PUBLIC_IP          # REQUIRED on a NAT'd VPS — see below
no-multicast-peers
no-loopback-peers              # stops the relay being used to reach your internals
min-port=49152
max-port=65535
cert=/etc/coturn/certs/turn-fullchain.pem
pkey=/etc/coturn/certs/turn-privkey.pem
```

`external-ip` is the single most common misconfiguration: most cloud VPSes NAT
their public IP, so without it coturn advertises private addresses and TURN
appears to work while every session fails. Put your real public IP there.

Generate the cert (a `turns:` endpoint needs TLS):

```bash
certbot certonly --standalone -d turn.example.com
mkdir -p turn-cert && cp /etc/letsencrypt/live/turn.example.com/{fullchain.pem,privkey.pem} turn-cert/
```

Never run TURN without credentials — an open relay is abused within hours.

Then set on Render:

```
TURN_URL=turns:turn.example.com:443?transport=tcp,turn:turn.example.com:3478?transport=udp
TURN_USERNAME=earbridge
TURN_CREDENTIAL=PASSWORD
```

If you would rather not run a server, Cloudflare TURN has a free tier but needs
a domain on Cloudflare, and public openrelay-style services are shared,
rate-limited, and must not be treated as reliable.

## Note on the client sources

`client/src/**` (React + Vite) is **not** what ships. `client/vite.config.ts`
sets `build.rollupOptions.input` to `stub.html` only, so the pages actually served
are the Stitch-exported standalone HTML files in `client/public/*.html`, which
Vite copies verbatim into `client/dist`.

Anything that must change in the deployed UI — including the `port + 1` removal and
the ICE-server injection — has to be applied to `client/public/sender.html` and
`client/public/receiver.html`. The matching changes in `client/src/lib/server.ts`
are already made so the code is correct if the build is ever pointed back at the
React entries.

## Scan → connect

The QR on the sender page encodes `https://<server>/receiver.html?id=<peerId>`.
Opening that URL sets `peerId` and auto-clicks Connect ~600 ms later, so the
phone connects with no further taps. Verified against the shipped page.

Two QR variants are available:

| URL | Scans to |
|---|---|
| `/qr.png?id=<peer>` | the mobile **browser** (default, most reliable) |
| `/qr.png?id=<peer>&format=app` | `earbridge://receiver?id=<peer>` → opens the **APK** |

The app format relies on Android resolving a custom scheme, which needs the
`<queries>` block in `AndroidManifest.xml` (Android 11+ package visibility).
It is there now. If a particular scanner refuses custom schemes it will simply do
nothing rather than fall back, so the browser form stays the default.

## Build the APK (GitHub Actions)

1. Push this repo to GitHub.
2. Set the repo **variable** `EARBRIDGE_SERVER` to your Render URL, e.g.
   `https://earbridge-abc123.onrender.com`. Optional — leave it unset for a
   LAN-only APK, where the receiver falls back to `location.origin`.
3. `.github/workflows/build-apk.yml` builds the debug APK on every push:
   `npm install` → `client` build (bakes in `EARBRIDGE_SERVER`) → `npx cap sync android`
   → `./gradlew assembleDebug`.
4. Download `earbridge-debug-apk` from the Actions run artifacts and install it.

## Local APK build (if you have the Android SDK)

```bash
EARBRIDGE_SERVER=https://your-app.onrender.com npm run build:client
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```
