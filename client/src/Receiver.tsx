import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { Bluetooth, Volume2, Ear, Copy } from "lucide-react";
import { Drawer } from "vaul";
import { Orb, type OrbState } from "./components/Orb";

import { controlWsUrl, peerOptions, abs, getServerBase, setServerBase } from "./lib/server";

export default function Receiver() {
  const [peerId, setPeerId] = useState("");
  const [status, setStatus] = useState<OrbState>("idle");
  const [route, setRoute] = useState("Bluetooth");
  const [serverUrl, setServerUrl] = useState(getServerBase());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<Peer | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (id) setPeerId(id);
    const poll = setInterval(async () => {
      try {
        const r = await fetch(abs("/sender-id"));
        const j = await r.json();
        if (j.id && !peerId) setPeerId(j.id);
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  function connect() {
    setStatus("connecting");
    const peer = new Peer(peerOptions());
    peerRef.current = peer;
    peer.on("open", () => {
      const conn = peer.connect(peerId);
      conn.on("open", () => conn.send("hello"));
    });
    peer.on("call", (call) => {
      call.answer();
      call.on("stream", (stream) => {
        if (audioRef.current) audioRef.current.srcObject = stream;
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

  function stopPc() {
    try { new WebSocket(controlWsUrl()).send(JSON.stringify({ cmd: "stop" })); } catch {}
    peerRef.current?.destroy();
    setStatus("idle");
  }

  return (
    <div className="min-h-screen p-4 grid place-items-center">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <input
          className="w-full rounded-xl bg-[var(--fill)] p-2.5 text-xs text-center"
          placeholder={`Server (default ${location.origin})`}
          value={serverUrl}
          onChange={(e) => { setServerUrl(e.target.value); setServerBase(e.target.value); }}
        />
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
        {status === "idle" || status === "error" ? (
          <button className="w-full rounded-full bg-[var(--accent)] py-4 text-lg font-semibold text-[#0d0d12]" onClick={connect} disabled={!peerId}>
            {peerId ? "Connect" : "Waiting for PC…"}
          </button>
        ) : (
          <button className="w-full rounded-full bg-[var(--danger)] py-4 text-lg font-semibold text-[#0d0d12]" onClick={stopPc}>Stop PC Audio</button>
        )}
        <button className="flex items-center gap-2 text-sm text-[var(--muted)]" onClick={() => navigator.clipboard.writeText(peerId)}>
          <Copy size={14} /> {peerId || "no pc"}
        </button>
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
      </div>
    </div>
  );
}
