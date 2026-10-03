import { motion } from "framer-motion";

export function Metric({ label, value, unit, ratio, warn }: { label: string; value: string; unit?: string; ratio: number; warn?: boolean }) {
  const color = warn === true || ratio > 0.8 ? "var(--danger)" : ratio > 0.5 ? "var(--warning)" : "var(--accent)";
  return (
    <div className="rounded-xl bg-[var(--fill)] p-3 flex-1 min-w-[110px]">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}<span className="text-xs text-[var(--muted)] ml-0.5">{unit}</span></div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--card)] overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ background: color, transformOrigin: "left" }} animate={{ scaleX: Math.min(Math.max(ratio, 0), 1) }} />
      </div>
    </div>
  );
}

export function MetricRow({ rtt, jitter, loss, bitrate, idle }: { rtt: number | null; jitter: number | null; loss: number | null; bitrate: number | null; idle: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Metric label="RTT" value={idle || rtt == null ? "—" : String(Math.round(rtt))} unit="ms" ratio={rtt ? rtt / 200 : 0} />
      <Metric label="Jitter" value={idle || jitter == null ? "—" : String(Math.round(jitter))} unit="ms" ratio={jitter ? jitter / 80 : 0} warn={jitter != null && jitter > 60} />
      <Metric label="Loss" value={idle || loss == null ? "—" : loss.toFixed(1)} unit="%" ratio={loss ? loss / 5 : 0} warn={(loss ?? 0) > 2} />
      <Metric label="Bitrate" value={idle || bitrate == null ? "—" : String(Math.round(bitrate))} unit="kbps" ratio={bitrate ? bitrate / 160 : 0} />
    </div>
  );
}
