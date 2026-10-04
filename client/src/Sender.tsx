import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";
import { Orb, type OrbState } from "./components/Orb";
import { MetricRow } from "./components/Metrics";

import { controlWsUrl, peerOptions, base } from "./lib/server";

export default function Sender() {
  const [sources, setSources] = useState<MediaDeviceInfo[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [status, setStatus] = useState<OrbState>("idle");
  const [peerId, setPeerId] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [metrics, setMetrics] = useState<{ rtt: number | null; jitter: number | null; loss: number | null; bitrate: number | null }>({ rtt: null, jitter: null, loss: null, bitrate: null });
  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<ReturnType<Peer["call"]> | null>(null);
  const micAudioRef = useRef<HTMLAudioElement | null>(null);
  const [phoneMicOn, setPhoneMicOn] = useState(false);
  const bytesRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devs = await navigator.mediaDevices.enumerateDevices();
        const inputs = devs.filter((d) => d.kind === "audioinput");
        setSources(inputs);
        const params = new URLSearchParams(location.search);
        if (params.get("autostart") === "1") {
          const monitor = inputs.find((d) => /monitor/i.test(d.label)) ?? inputs[0];
          if (monitor) setSourceId(monitor.deviceId);
          start(monitor?.deviceId);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ws = new WebSocket(controlWsUrl());
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ role: "sender", id: peerId ?? undefined }));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.cmd === "stop") stop();
      } catch {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify({ role: "sender", id: peerId ?? undefined }));
  }, [peerId]);

  useEffect(() => {
    const t = setInterval(async () => {
      const pc = callRef.current?.peerConnection;
      if (!pc || status !== "live") return;
      const stats = await (pc as any).getStats();
      let rtt: number | null = null, jitter: number | null = null, loss: number | null = null, bytes = 0;
      stats.forEach((s: any) => {
        if (s.type === "outbound-rtp" && s.kind === "audio") { bytes += s.bytesSent ?? 0; }
        if (s.type === "remote-inbound-rtp") { rtt = s.roundTripTime != null ? s.roundTripTime * 1000 : null; loss = s.fractionLost != null ? s.fractionLost * 100 : null; }
        if (s.type === "inbound-rtp" && s.kind === "audio") { jitter = s.jitter != null ? s.jitter * 1000 : null; }
      });
      const prevBytes = bytesRef.current;
      let bitrate = null;
      if (prevBytes != null) bitrate = Math.max(0, ((bytes - prevBytes) * 8) / 2000);
      bytesRef.current = bytes;
      setMetrics({ rtt, jitter, loss, bitrate });
    }, 2000);
    return () => clearInterval(t);
  }, [status]);

  async function start(deviceId?: string) {
    try {
      const picked = deviceId ?? sourceId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: picked ? { exact: picked } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      setStatus("connecting");
      const peer = new Peer(peerOptions());
      peerRef.current = peer;
      peer.on("open", (id) => {
        setPeerId(id);
        setStatus("live");
        fetch(`/receiver-url?id=${encodeURIComponent(id)}`)
          .then((r) => r.json())
          .then((j) => setQrUrl(j.url))
          .catch(() => setQrUrl(`${base()}/receiver.html?id=${id}`));
      });
      peer.on("connection", (conn) => conn.on("data", (msg) => { if (msg === "hello") { callRef.current = peer.call(conn.peer, stream); setPhoneConnected(true); } }));
      peer.on("call", (call) => {
        call.answer();
        call.on("stream", (micStream) => {
          if (micAudioRef.current) micAudioRef.current.srcObject = micStream;
          setPhoneMicOn(true);
        });
        call.on("close", () => setPhoneMicOn(false));
      });
      peer.on("disconnected", () => { try { peer.reconnect(); } catch {} setStatus("reconnecting"); });
      peer.on("error", () => setStatus("error"));
    } catch { setStatus("error"); }
  }

  function stop() {
    callRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    peerRef.current?.destroy();
    setStatus("idle"); setPhoneConnected(false); setPeerId(null); setPhoneMicOn(false);
    setMetrics({ rtt: null, jitter: null, loss: null, bitrate: null });
  }

  return (
    <div className="min-h-screen p-4 grid place-items-center">
      <div className="w-full max-w-[880px] rounded-2xl bg-[var(--card)] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2.5">
            <img src="/earbridge-logo.png" alt="Earbridge" className="w-9 h-9 rounded-full" />
            Earbridge <span className="text-sm font-normal text-[var(--muted)]">Sender</span>
          </h1>
          {status === "live" && <span className="flex items-center gap-2 text-[var(--accent)] text-sm font-semibold"><span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse-dot" />LIVE</span>}
        </div>
        <div className="grid md:grid-cols-2 gap-6 mt-6 items-center">
          <div className="flex flex-col items-center gap-4">
            <Orb state={status} size={160} />
            <select className="w-full rounded-xl bg-[var(--fill)] p-3 text-sm" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Default microphone</option>
              {sources.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
            </select>
            {status === "idle" || status === "error" ? (
              <button className="w-full rounded-full bg-[var(--accent)] py-3 font-semibold text-[#0d0d12]" onClick={() => start()}>Start Streaming</button>
            ) : (
              <button className="w-full rounded-full bg-[var(--danger)] py-3 font-semibold text-[#0d0d12]" onClick={stop}>Stop</button>
            )}
          </div>
          <div className="flex flex-col items-center gap-3">
            {peerId ? (
              <>
                <div className="rounded-2xl bg-white p-3"><QRCodeSVG value={qrUrl} size={150} /></div>
                <div className="text-xs text-[var(--muted)] break-all text-center max-w-[220px]">{qrUrl.replace(/\?id=.*$/, "")}</div>
                <button className="flex items-center gap-2 text-sm text-[var(--muted)]" onClick={() => navigator.clipboard.writeText(peerId)}>
                  <Copy size={14} /> {peerId.slice(0, 12)}…
                </button>
                {phoneConnected && <div className="text-[var(--accent)] text-sm">Phone connected ✓</div>}
                {phoneMicOn && <div className="text-[var(--accent)] text-sm">Phone mic live ✓</div>}
              </>
            ) : (
              <div className="text-[var(--muted)] text-sm">Start streaming to see the QR code</div>
            )}
          </div>
        </div>
        <div className="mt-6"><MetricRow {...metrics} idle={status !== "live"} /></div>
        <audio ref={micAudioRef} autoPlay playsInline className="hidden" />
      </div>
    </div>
  );
}
