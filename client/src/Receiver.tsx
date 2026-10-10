import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { Bluetooth, Volume2, Ear, Copy, Mic, MicOff, VolumeX } from "lucide-react";
import { Drawer } from "vaul";
import { Orb, type OrbState } from "./components/Orb";

import { controlWsUrl, peerOptions, abs, getServerBase, setServerBase, getSavedServers, pushSavedServer, iceServers } from "./lib/server";

function MicMeter({ stream, muted }: { stream: MediaStream | null; muted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stream) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 2) {
        const value = Math.abs((data[i] - 128) / 128);
        if (value > peak) peak = value;
      }
      const width = canvas.width;
      const height = canvas.height;
      const g = canvas.getContext("2d");
      if (g) {
        g.clearRect(0, 0, width, height);
        const level = muted ? 0 : peak;
        g.fillStyle = level > 0.7 ? "#f87171" : level > 0.35 ? "#4ade80" : "#38bdf8";
        g.fillRect(0, 0, Math.min(width, width * level), height);
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      try {
        ctx.close().catch(() => {});
      } catch {}
    };
  }, [stream, muted]);
  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={10}
      className="w-full rounded-full bg-[var(--card)]"
      aria-hidden="true"
    />
  );
}

export default function Receiver() {
  const [peerId, setPeerId] = useState("");
  const [status, setStatus] = useState<OrbState>("idle");
  const [route, setRoute] = useState("Bluetooth");
  const [serverUrl, setServerUrl] = useState(getServerBase());
  const [savedServers, setSavedServers] = useState<string[]>(getSavedServers());
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("earbridge_volume"));
    return Number.isFinite(saved) ? Math.min(Math.max(saved, 0), 1) : 1;
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCallRef = useRef<ReturnType<Peer["call"]> | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (id) {
      setPeerId(id);
      setTimeout(() => document.getElementById("connect-btn")?.click(), 500);
    }
    let removeListener: (() => void) | undefined;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const listener = await App.addListener("appUrlOpen", (event: { url: string }) => {
          try {
            const deepId = new URL(event.url).searchParams.get("id");
            if (deepId) {
              setPeerId(deepId);
              setTimeout(() => document.getElementById("connect-btn")?.click(), 500);
            }
          } catch {}
        });
        removeListener = () => listener.remove();
      } catch {}
    })();
    const poll = setInterval(async () => {
      try {
        const r = await fetch(abs("/sender-id"));
        const j = await r.json();
        if (j.id && !peerId) setPeerId(j.id);
      } catch {}
    }, 2000);
    return () => {
      clearInterval(poll);
      removeListener?.();
    };
  }, [serverUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    try {
      localStorage.setItem("earbridge_volume", String(volume));
    } catch {}
  }, [volume]);

  function applyServer(value: string) {
    setServerUrl(value);
    setServerBase(value);
    pushSavedServer(value);
    setSavedServers(getSavedServers());
  }

  async function connect() {
    setStatus("connecting");
    const peer = new Peer(peerOptions(await iceServers()));
    peerRef.current = peer;
    peer.on("open", () => {
      const conn = peer.connect(peerId);
      conn.on("open", () => conn.send("hello"));
    });
    peer.on("call", (call) => {
      call.answer();
      call.on("stream", (stream) => {
        if (audioRef.current) {
          audioRef.current.srcObject = stream;
          audioRef.current.volume = volume;
        }
        audioRef.current?.play?.().catch(() => {});
        (audioContextResume() as any);
        setStatus("live");
      });
    });
    peer.on("disconnected", () => { try { peer.reconnect(); } catch {} setStatus("reconnecting"); });
    peer.on("error", () => setStatus("error"));
  }

  function audioContextResume() {
    try {
      const ctx = new (window as any).AudioContext();
      ctx.resume();
    } catch {}
  }

  async function toggleMic() {
    if (micOn) {
      micCallRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setMicStream(null);
      setMicOn(false);
      setMicMuted(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micStreamRef.current = stream;
      setMicStream(stream);
      setMicMuted(false);
      if (!peerRef.current) return;
      const call = peerRef.current.call(peerId, stream);
      micCallRef.current = call;
      setMicOn(true);
    } catch {
      micStreamRef.current = null;
      setMicStream(null);
      setMicOn(false);
      setMicMuted(false);
    }
  }

  function toggleMicMuted() {
    const next = !micMuted;
    micStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMicMuted(next);
  }

  function stopPc() {
    // send() on a CONNECTING socket throws InvalidStateError; wait for open or
    // the "Stop PC Audio" command silently never reaches the sender.
    try {
      const ws = new WebSocket(controlWsUrl());
      ws.onopen = () => ws.send(JSON.stringify({ cmd: "stop" }));
    } catch {}

    micCallRef.current?.close();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setMicStream(null);
    setMicOn(false);
    setMicMuted(false);
    peerRef.current?.destroy();
    setStatus("idle");
  }

  return (
    <div className="min-h-screen p-4 grid place-items-center">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="flex items-center gap-2 text-[var(--muted)]">
          <img src="/earbridge-logo.png" alt="Earbridge" className="w-7 h-7 rounded-full" />
          <span className="text-sm font-semibold tracking-wide">Earbridge</span>
        </div>
        <form
          className="w-full"
          onSubmit={(e) => {
            e.preventDefault();
            if (serverUrl.trim()) applyServer(serverUrl);
          }}
        >
          <input
            className="w-full rounded-xl bg-[var(--fill)] p-2.5 text-xs text-center"
            placeholder={`Server (default ${location.origin})`}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            onBlur={() => {
              if (serverUrl.trim()) applyServer(serverUrl);
            }}
          />
        </form>
        {savedServers.length > 0 && (
          <div className="flex w-full flex-wrap justify-center gap-2">
            {savedServers.map((saved) => (
              <button
                key={saved}
                type="button"
                className="rounded-full bg-[var(--fill)] px-3 py-1 text-xs text-[var(--text)]"
                onClick={() => applyServer(saved)}
              >
                {saved.replace(/^https?:\/\//, "")}
              </button>
            ))}
          </div>
        )}
        <Orb state={status} size={190} />
        <p aria-live="polite" className="text-center text-lg font-semibold min-h-[2rem]">
          {status === "idle" && "Ready to connect"}
          {status === "connecting" && "Connecting…"}
          {status === "live" && `Receiving to ${route}`}
          {status === "reconnecting" && "Reconnecting…"}
          {status === "error" && "Connection error"}
        </p>
        {status === "live" && (
          <Drawer.Root>
            <Drawer.Trigger asChild>
              <button className="flex items-center gap-2 rounded-full bg-[var(--fill)] px-4 py-2">
                <Bluetooth size={16} /> {route}
              </button>
            </Drawer.Trigger>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-black/60" />
              <Drawer.Content className="fixed bottom-0 left-0 right-0 rounded-t-2xl bg-[var(--card)] p-5">
                <Drawer.Title className="font-semibold mb-3">Output device</Drawer.Title>
                {["Bluetooth", "Speaker", "Earpiece"].map((r) => (
                  <button key={r} className="flex w-full items-center gap-3 rounded-xl p-3 hover:bg-[var(--fill)]" onClick={() => setRoute(r)}>
                    {r === "Bluetooth" ? <Bluetooth size={18} /> : r === "Speaker" ? <Volume2 size={18} /> : <Ear size={18} />} {r}
                  </button>
                ))}
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        )}
        {status === "live" && (
          <div className="flex w-full items-center gap-3 rounded-2xl bg-[var(--fill)] px-4 py-3">
            <button
              type="button"
              aria-label={volume === 0 ? "Unmute PC audio" : "Mute PC audio"}
              className="text-[var(--text)]"
              onClick={() => setVolume(volume === 0 ? 1 : 0)}
            >
              {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="w-full accent-[#4ade80]"
              aria-label="PC audio volume"
            />
            <span className="w-10 text-right text-xs tabular-nums text-[var(--muted)]">{Math.round(volume * 100)}%</span>
          </div>
        )}
        {status === "idle" || status === "error" ? (
          <button id="connect-btn" className="w-full rounded-full bg-[var(--accent)] py-4 text-lg font-semibold text-[#0d0d12]" onClick={connect} disabled={!peerId}>
            {peerId ? "Connect" : "Waiting for PC…"}
          </button>
        ) : (
          <button className="w-full rounded-full bg-[var(--danger)] py-4 text-lg font-semibold text-[#0d0d12]" onClick={stopPc}>Stop PC Audio</button>
        )}
        <div className="flex w-full flex-col gap-2">
          <button
            className={`w-full rounded-full py-3 font-semibold ${micOn ? "bg-[var(--accent)] text-[#0d0d12]" : "bg-[var(--fill)] text-[var(--text)]"}`}
            onClick={toggleMic}
          >
            {micOn ? "🎤 Phone mic ON — tap to stop" : "🎤 Use phone as mic for PC"}
          </button>
          {micOn && (
            <div className="flex w-full items-center gap-3 rounded-2xl bg-[var(--fill)] px-4 py-3">
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]"
                onClick={toggleMicMuted}
                aria-pressed={micMuted}
              >
                {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
                {micMuted ? "Unmute" : "Mute"}
              </button>
              <div className="flex-1">
                <MicMeter stream={micStream} muted={micMuted} />
              </div>
            </div>
          )}
        </div>
        <button className="flex items-center gap-2 text-sm text-[var(--muted)]" onClick={() => navigator.clipboard.writeText(peerId)}>
          <Copy size={14} /> {peerId || "no pc"}
        </button>
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
      </div>
    </div>
  );
}
