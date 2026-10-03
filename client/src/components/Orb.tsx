import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../lib/cn";

export type OrbState = "idle" | "connecting" | "live" | "reconnecting" | "error";

export function Orb({ state, size = 180 }: { state: OrbState; size?: number }) {
  const reduce = useReducedMotion();
  const colors: Record<OrbState, string> = {
    idle: "#3a3a48",
    connecting: "var(--accent)",
    live: "var(--accent)",
    reconnecting: "var(--warning)",
    error: "var(--danger)",
  };
  const c = colors[state];

  return (
    <div className="relative grid place-items-center" style={{ width: size * 1.5, height: size * 1.5 }}>
      {state === "live" && !reduce && (
        <>
          <motion.div
            className="absolute rounded-full blur-3xl"
            style={{ width: size, height: size, background: `color-mix(in srgb, ${c} 45%, transparent)` }}
            animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute rounded-full border"
            style={{ width: size, height: size, borderColor: `color-mix(in srgb, ${c} 60%, transparent)` }}
            animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
        </>
      )}
      {(state === "connecting" || state === "reconnecting") && !reduce && (
        <motion.div
          className="absolute rounded-full border-[3px] border-transparent"
          style={{ width: size, height: size, borderTopColor: c }}
          animate={{ rotate: 360 }}
          transition={{ duration: state === "connecting" ? 1 : 1.4, repeat: Infinity, ease: "linear" }}
        />
      )}
      <motion.div
        className={cn("rounded-full", state === "idle" && "opacity-60")}
        style={{
          width: size,
          height: size,
          background: state === "idle" ? "#22222e" : `color-mix(in srgb, ${c} 90%, black)`,
        }}
        animate={state === "idle" && !reduce ? { scale: [1, 1.03, 1] } : {}}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="absolute text-center font-semibold text-sm" style={{ color: state === "idle" ? "var(--muted)" : "#0d0d12" }}>
        {state === "live" && "LIVE"}
        {state === "connecting" && "Connecting…"}
        {state === "reconnecting" && "Reconnecting…"}
        {state === "error" && "Error"}
        {state === "idle" && "Idle"}
      </div>
    </div>
  );
}
