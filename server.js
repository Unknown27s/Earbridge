const express = require("express");
const http = require("http");
const { ExpressPeerServer } = require("peer");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");
const os = require("os");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT) || 3000;

// Virtual/container adapters that are reachable from the server but useless to
// a phone on the same wifi. Returning one of these puts an unreachable address
// in the QR code.
const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vboxnet|vmnet|tun|tap|tailscale|zt|wg|lo$|ap\d|ham)/i;

function localIPv4s() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (VIRTUAL_IFACE.test(name)) continue;
      out.push({ name, address: a.address });
    }
  }
  return out;
}

// The QR code has to contain an address the phone can actually reach. With
// several adapters up (Ethernet + wifi + docker) "first non-internal address" is
// a coin flip, so prefer one on the same /24 as the client that is asking.
function getLocalIP(remoteAddr) {
  const candidates = localIPv4s();
  if (!candidates.length) return "localhost";

  if (remoteAddr) {
    const remote = String(remoteAddr).replace(/^::ffff:/, "");
    const sameSubnet = candidates.filter(
      (c) => c.address.split(".").slice(0, 3).join(".") === remote.split(".").slice(0, 3).join(".")
    );
    if (sameSubnet.length === 1) return sameSubnet[0].address;
    if (sameSubnet.length > 1) return sameSubnet[0].address;
  }
  return candidates[0].address;
}

// The origin peers should actually reach. Behind a proxy (Render, nginx, the
// GitHub Codespaces port forwarder) the forwarded headers win; a pinned env var
// wins over everything; LAN is the last resort.
function publicOrigin(req) {
  const configured = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (req) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    if (host) {
      const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
        .split(",")[0]
        .trim();
      return `${proto}://${host}`;
    }
  }
  return `http://${getLocalIP(req && req.socket && req.socket.remoteAddress)}:${PORT}`;
}

// STUN alone is enough on one LAN but not across the internet: symmetric NAT on
// either side kills the direct path and WebRTC never connects. Configure a TURN
// relay with TURN_URL (comma-separated) to make the cloud deployment reliable.
const iceServers = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];
if (process.env.TURN_URL) {
  const urls = String(process.env.TURN_URL)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length) {
    iceServers.push({
      urls,
      ...(process.env.TURN_USERNAME ? { username: process.env.TURN_USERNAME } : {}),
      ...(process.env.TURN_CREDENTIAL ? { credential: process.env.TURN_CREDENTIAL } : {}),
    });
  }
}

const app = express();
app.set("trust proxy", true);
const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, {
  debug: false,
  proxied: true,
  iceServers,
});
app.use("/peerjs", peerServer);

const clientDist = path.join(__dirname, "client/dist");
if (!fs.existsSync(clientDist)) {
  console.warn(
    `\n  WARNING: ${clientDist} is missing — sender/receiver pages will 404.\n` +
      `  Build the client first:  cd client && npm ci && npm run build\n`
  );
}
app.use(express.static(clientDist));
app.use(express.static(path.join(__dirname, "public")));
app.use("/peerjs-client", express.static(path.join(__dirname, "node_modules/peerjs/dist")));

let currentSenderId = null;

// The address the phone will dial must be reachable *from that phone*, so derive
// it from the requesting client rather than guessing which adapter is "first".
const clientIP = (req) => getLocalIP(req && req.socket && req.socket.remoteAddress);

function receiverUrl(req, id) {
  // format=app encodes an earbridge:// deep link so the QR opens the APK.
  // Requires <queries> in AndroidManifest.xml (Android 11+ package visibility);
  // a scanner that cannot handle custom schemes will just do nothing, so the
  // web form stays the default.
  if (req.query.format === "app" && id) {
    return `earbridge://receiver?id=${encodeURIComponent(id)}`;
  }
  const url = `${publicOrigin(req)}/receiver.html`;
  return id ? `${url}?id=${encodeURIComponent(id)}` : url;
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), sender: currentSenderId });
});

app.get("/ice-servers", (_req, res) => {
  res.json({ iceServers });
});

app.get("/qr.png", async (req, res) => {
  const buf = await QRCode.toBuffer(receiverUrl(req, req.query.id), { width: 300, margin: 2 });
  res.type("png").send(buf);
});

app.get("/receiver-url", (req, res) => {
  res.json({ url: receiverUrl(req, req.query.id) });
});

app.get("/sender-id", (_req, res) => res.json({ id: currentSenderId }));

// The control channel shares the main server's single port. Render only exposes
// PORT, so a second listener on PORT + 1 would never be reachable from outside.
//
// peer registers its own ws server on this same HTTP server pinned to an exact
// path ("/peerjs/peerjs"). ws's handleUpgrade calls abortHandshake(400) on any
// path mismatch, which writes a raw "HTTP/1.1 400" into the socket. If it sees
// the /control request *after* the upgrade completed, that 400 lands inside a
// live WebSocket stream and corrupts framing on both ends. So claim /control
// first and skip peer entirely for that path.
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

const isControl = (req) => typeof req.url === "string" && req.url.startsWith("/control");

const inherited = server.listeners("upgrade");
server.removeAllListeners("upgrade");

server.on("upgrade", (req, socket, head) => {
  if (!isControl(req)) return;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

for (const listener of inherited) {
  server.on("upgrade", (req, socket, head) => {
    if (isControl(req)) return;
    listener.call(server, req, socket, head);
  });
}

let senderWs = null;
wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.role === "sender") {
      senderWs = ws;
      if (msg.id) currentSenderId = msg.id;
    } else if (msg.cmd && senderWs && senderWs.readyState === 1) {
      senderWs.send(JSON.stringify(msg));
    }
    if (msg.role === "sender" && msg.cmd === "status") {
      wss.clients.forEach((c) => {
        if (c !== ws && c.readyState === 1) c.send(JSON.stringify(msg));
      });
    }
  });
  ws.on("close", () => {
    if (ws === senderWs) senderWs = null;
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const origin = publicOrigin(null);
  const remote = /^https:\/\//i.test(origin);
  // The PC must use localhost: browsers only expose getUserMedia in a secure
  // context (https://, localhost, 127.0.0.1). Opening the sender on the LAN IP
  // over plain http leaves navigator.mediaDevices undefined, so Start silently
  // does nothing. The phone, by contrast, must use whatever address is
  // reachable from the handset.
  const senderUrl = remote ? `${origin}/sender.html` : `http://localhost:${PORT}/sender.html`;
  console.log(`\n  PC sender page:   ${senderUrl}`);
  console.log(`  Phone receiver:   ${origin}/receiver.html`);
  console.log(`  QR code:          http://localhost:${PORT}/qr.png`);
  if (!remote) {
    console.log(`\n  Note: open the sender on localhost, not ${origin.replace(/^https?:\/\//, "")}.`);
    console.log(`        A LAN address over http is not a secure context, so the browser`);
    console.log(`        blocks microphone capture and Start will not work.`);
  }
  console.log(`\n  Signalling:       ${origin}/peerjs`);
  console.log(`  Control WS:       ${origin.replace(/^http/, "ws")}/control`);
  console.log(`  TURN relay:       ${process.env.TURN_URL ? process.env.TURN_URL : "not configured (LAN / non-symmetric NAT only)"}\n`);
});
