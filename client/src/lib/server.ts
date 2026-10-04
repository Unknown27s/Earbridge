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
  return getServerBase() || location.origin;
}

export function isCapacitorApp(): boolean {
  return typeof (window as any).Capacitor !== "undefined";
}

export function peerOptions() {
  const u = new URL(base());
  return {
    host: u.hostname,
    port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
    path: "/peerjs",
    secure: u.protocol === "https:",
  };
}

export function controlWsUrl(): string {
  const u = new URL(base());
  const proto = u.protocol === "https:" ? "wss" : "ws";
  const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  return `${proto}://${u.hostname}:${port + 1}/control`;
}

export function abs(path: string): string {
  return base().replace(/\/+$/, "") + path;
}
