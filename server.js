const express = require("express");
const http = require("http");
const { ExpressPeerServer } = require("peer");
const { WebSocketServer } = require("ws");
const path = require("path");
const os = require("os");
const QRCode = require("qrcode");

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

const app = express();
const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, { debug: false });
app.use("/peerjs", peerServer);

app.use(express.static(path.join(__dirname, "client/dist")));
app.use(express.static(path.join(__dirname, "public")));
app.use("/peerjs-client", express.static(path.join(__dirname, "node_modules/peerjs/dist")));

// The address the phone will dial must be reachable *from that phone*, so derive
// it from the requesting client rather than guessing which adapter is "first".
const clientIP = (req) => getLocalIP(req && req.socket && req.socket.remoteAddress);

app.get("/qr.png", async (req, res) => {
  let url = `http://${clientIP(req)}:${PORT}/receiver.html`;
  if (req.query.id) url += `?id=${encodeURIComponent(req.query.id)}`;
  const buf = await QRCode.toBuffer(url, { width: 300, margin: 2 });
  res.type("png").send(buf);
});

app.get("/receiver-url", (req, res) => {
  if (req.query.format === "app" && req.query.id) {
    return res.json({ url: `earbridge://receiver?id=${encodeURIComponent(req.query.id)}` });
  }
  let url = `http://${clientIP(req)}:${PORT}/receiver.html`;
  if (req.query.id) url += `?id=${encodeURIComponent(req.query.id)}`;
  res.json({ url });
});

let currentSenderId = null;
app.get("/sender-id", (req, res) => res.json({ id: currentSenderId }));

// Must be a Number: PORT comes from the environment as a string, and the control
// channel binds PORT + 1. With a string that is concatenation ("4016" + 1 =
// "40161"), so the client would look on 4017 while the server listens on 40161.
const PORT = Number(process.env.PORT) || 3000;
const IP = getLocalIP();

const wss = new WebSocketServer({ noServer: true });
const controlServer = http.createServer();
controlServer.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/control")) wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  else socket.destroy();
});
let senderWs = null;
wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.role === "sender") {
      senderWs = ws;
      if (msg.id) currentSenderId = msg.id;
    } else if (msg.cmd && senderWs && senderWs.readyState === 1) {
      senderWs.send(JSON.stringify(msg));
    }
    if (msg.role === "sender" && msg.cmd === "status") {
      wss.clients.forEach((c) => { if (c !== ws && c.readyState === 1) c.send(JSON.stringify(msg)); });
    }
  });
  ws.on("close", () => { if (ws === senderWs) senderWs = null; });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  PC sender page:  http://localhost:${PORT}/sender.html`);
  console.log(`  Phone receiver:  http://${IP}:${PORT}/receiver.html`);
  console.log(`  QR code:         http://localhost:${PORT}/qr.png\n`);
});

controlServer.listen(PORT + 1, "0.0.0.0", () => {
  console.log(`  Control WS:      ws://${IP}:${PORT + 1}/control\n`);
});
