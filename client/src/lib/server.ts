export function getServerBase(): string {
  return localStorage.getItem("earbridge_server") || "";
}

export function setServerBase(url: string) {
  localStorage.setItem("earbridge_server", url.replace(/\/+$/, ""));
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
