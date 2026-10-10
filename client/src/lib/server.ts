const DEFAULT_SERVER = (() => {
  try {
    return normalizeServer(import.meta.env.VITE_EARBRIDGE_SERVER || "");
  } catch {
    return "";
  }
})();

export function getServerBase(): string {
  return localStorage.getItem("earbridge_server") || "";
}

export function normalizeServer(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function setServerBase(url: string) {
  const normalized = normalizeServer(url);
  if (normalized) localStorage.setItem("earbridge_server", normalized);
  else localStorage.removeItem("earbridge_server");
}

export function getSavedServers(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("earbridge_servers") || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushSavedServer(url: string) {
  const normalized = normalizeServer(url);
  if (!normalized) return;
  const next = [normalized, ...getSavedServers().filter((x) => x !== normalized)].slice(0, 3);
  localStorage.setItem("earbridge_servers", JSON.stringify(next));
}

export function base(): string {
  // location.origin is wrong inside the Capacitor WebView (it is https://localhost),
  // so a VITE_EARBRIDGE_SERVER baked in at build time takes precedence there.
  return getServerBase() || DEFAULT_SERVER || location.origin;
}

export function isCapacitorApp(): boolean {
  return typeof (window as any).Capacitor !== "undefined";
}

let iceCache: RTCIceServer[] | null = null;

export async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache) return iceCache;
  let result: RTCIceServer[] = [];
  try {
    const r = await fetch(abs("/ice-servers"), { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j.iceServers) && j.iceServers.length) result = j.iceServers;
    }
  } catch {
    // fall through to peerjs defaults
  }
  iceCache = result;
  return result;
}

export function peerOptions(ice: RTCIceServer[] = []) {
  const u = new URL(base());
  return {
    host: u.hostname,
    port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
    path: "/peerjs",
    secure: u.protocol === "https:",
    ...(ice.length ? { config: { iceServers: ice } } : {}),
  };
}

export function controlWsUrl(): string {
  const u = new URL(base());
  const proto = u.protocol === "https:" ? "wss" : "ws";
  // Same port as the signalling server: Render exposes PORT only, so the
  // control channel has to ride on it (u.host already carries any port).
  return `${proto}://${u.host}/control`;
}

export function abs(path: string): string {
  return base().replace(/\/+$/, "") + path;
}
