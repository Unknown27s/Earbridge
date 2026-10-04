const express = require("express");
const http = require("http");
const { ExpressPeerServer } = require("peer");
const { WebSocketServer } = require("ws");
const path = require("path");
const os = require("os");
const QRCode = require("qrcode");

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

const app = express();
const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, { debug: false });
app.use("/peerjs", peerServer);

app.use(express.static(path.join(__dirname, "client/dist")));
app.use(express.static(path.join(__dirname, "public")));
app.use("/peerjs-client", express.static(path.join(__dirname, "node_modules/peerjs/dist")));

app.get("/qr.png", async (req, res) => {
  let url = `http://${getLocalIP()}:${PORT}/receiver.html`;
  if (req.query.id) url += `?id=${encodeURIComponent(req.query.id)}`;
  const buf = await QRCode.toBuffer(url, { width: 300, margin: 2 });
  res.type("png").send(buf);
});

app.get("/receiver-url", (req, res) => {
  let url = `http://${getLocalIP()}:${PORT}/receiver.html`;
  if (req.query.id) url += `?id=${encodeURIComponent(req.query.id)}`;
  res.json({ url });
});

let currentSenderId = null;
app.get("/sender-id", (req, res) => res.json({ id: currentSenderId }));

const PORT = process.env.PORT || 3000;
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
