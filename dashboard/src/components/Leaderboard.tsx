import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LeaderboardEntry } from "../chain.js";
import { shortAddr, fmt, bpsToPct } from "../format.js";

export interface LeaderboardProps {
  entries: LeaderboardEntry[] | null;
  decimals: number;
  symbol: string;
  canWrite: boolean;
  busy: boolean;
  onFollow: (id: bigint, maxSlippageBps: number, maxPositionSizeBps: number) => void;
  onUnfollow: (id: bigint) => void;
}

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 50%)`;
}

// ---- Safety slider follow form ----

type Preset = "safe" | "moderate" | "aggressive" | "custom";

const PRESETS: Record<Exclude<Preset, "custom">, { slipPct: number; posPct: number }> = {
  safe:       { slipPct: 1,  posPct: 10 },
  moderate:   { slipPct: 2,  posPct: 25 },
  aggressive: { slipPct: 4,  posPct: 40 },
};

function detectPreset(slipPct: number, posPct: number): Preset {
  const key = (Object.keys(PRESETS) as Exclude<Preset, "custom">[]).find(
    (p) => PRESETS[p].slipPct === slipPct && PRESETS[p].posPct === posPct,
  );
  return key ?? "custom";
}

const formVariants = {
  hidden: { opacity: 0, y: -6, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.13, ease: [0.23, 1, 0.32, 1] } },
};

const tap = { scale: 0.97 };
const tapTransition = { duration: 0.12, ease: [0.23, 1, 0.32, 1] as const };

function FollowForm({
  id, busy, onFollow,
}: {
  id: bigint;
  busy: boolean;
  onFollow: LeaderboardProps["onFollow"];
}) {
  const [slipPct, setSlipPct] = useState(PRESETS.moderate.slipPct);
  const [posPct, setPosPct]   = useState(PRESETS.moderate.posPct);
  const preset = detectPreset(slipPct, posPct);

  const applyPreset = (p: Exclude<Preset, "custom">) => {
    setSlipPct(PRESETS[p].slipPct);
    setPosPct(PRESETS[p].posPct);
  };

  return (
    <motion.div
      className="follow-form"
      variants={formVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="preset-row">
        {(["safe", "moderate", "aggressive"] as const).map((p) => (
          <motion.button
            key={p}
            className={`preset-btn${preset === p ? " active" : ""}`}
            whileTap={tap}
            transition={tapTransition}
            onClick={() => applyPreset(p)}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </motion.button>
        ))}
        {preset === "custom" && <span className="preset-custom">Custom</span>}
      </div>

      <label className="slider-label">
        <span>Max slippage</span>
        <span className="slider-val">{slipPct.toFixed(1)}%</span>
      </label>
      <input
        type="range"
        className="risk-slider"
        min={0.1} max={5} step={0.1}
        value={slipPct}
        onChange={(e) => setSlipPct(Number(e.target.value))}
      />

      <label className="slider-label">
        <span>Max position size</span>
        <span className="slider-val">{posPct}%</span>
      </label>
      <input
        type="range"
        className="risk-slider"
        min={1} max={50} step={1}
        value={posPct}
        onChange={(e) => setPosPct(Number(e.target.value))}
      />

      <motion.button
        className="primary"
        disabled={busy}
        whileTap={tap}
        transition={tapTransition}
        onClick={() => onFollow(id, Math.round(slipPct * 100), Math.round(posPct * 100))}
      >
        Confirm follow
      </motion.button>
      <span className="hint">caps: 5% slippage · 50% position</span>
    </motion.div>
  );
}

// ---- Leaderboard card list ----

const listVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.23, 1, 0.32, 1] } },
};

export function Leaderboard({ entries, decimals, symbol, canWrite, busy, onFollow, onUnfollow }: LeaderboardProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (entries === null) {
    return (
      <div className="card">
        <p className="empty">Loading track records…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="card">
        <p className="empty">No strategies registered yet.</p>
      </div>
    );
  }

  return (
    <motion.div className="card rows" variants={listVariants} initial="hidden" animate="visible">
      {entries.map((e) => {
        const key = e.id.toString();
        const following = !!e.follow?.active;
        const pnlPositive = e.pnlBase >= 0n;
        const hasTrades = e.closedCount > 0;

        return (
          <motion.div key={key} className="row-group" variants={rowVariants} layout="position">
            <div className={`row leaderboard-row ${e.active ? "" : "inactive"}`}>
              <span className="avatar" style={{ background: avatarColor(e.strategyWallet) }}>
                {key}
              </span>

              <div className="row-main">
                <div className="row-title">
                  {shortAddr(e.strategyWallet)}
                  {e.verified && <span className="badge verified">✓ Verified</span>}
                  {following && <span className="badge following">following</span>}
                </div>
                <div className="row-sub">{bpsToPct(e.profitShareBps)} profit share · {e.active ? "active" : "inactive"}</div>

                <div className="leaderboard-stats">
                  <div className="stat">
                    <span className="stat-label">All-time P&amp;L</span>
                    <span className={`stat-value ${pnlPositive ? "pos" : "neg"}`}>
                      {pnlPositive ? "+" : "−"}
                      {fmt(pnlPositive ? e.pnlBase : -e.pnlBase, decimals, 4)} {symbol}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Win rate</span>
                    <span className="stat-value">
                      {hasTrades ? `${e.winRate}%` : "—"}
                      {hasTrades && <span className="stat-sub"> ({e.closedCount} trade{e.closedCount !== 1 ? "s" : ""})</span>}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Skin in the game</span>
                    <span className="stat-value">{fmt(e.skinBase, decimals, 2)} {symbol}</span>
                  </div>
                </div>
              </div>

              <div className="row-right">
                {!canWrite ? (
                  <span className="hint">connect wallet</span>
                ) : following ? (
                  <motion.button whileTap={tap} transition={tapTransition} disabled={busy} onClick={() => onUnfollow(e.id)}>
                    Unfollow
                  </motion.button>
                ) : e.active ? (
                  <motion.button
                    className={openId === key ? "" : "primary"}
                    whileTap={tap}
                    transition={tapTransition}
                    disabled={busy}
                    onClick={() => setOpenId(openId === key ? null : key)}
                  >
                    {openId === key ? "Cancel" : "Follow"}
                  </motion.button>
                ) : null}
              </div>
            </div>

            <AnimatePresence>
              {canWrite && openId === key && !following && (
                <FollowForm
                  id={e.id}
                  busy={busy}
                  onFollow={(id, slipBps, posBps) => {
                    setOpenId(null);
                    onFollow(id, slipBps, posBps);
                  }}
                />
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
