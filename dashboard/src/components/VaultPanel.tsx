import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { BaseMeta, Position } from "../chain.js";
import { fmt, fmtSigned, toFloat, fmtFloat } from "../format.js";
import { Contour } from "./Contour.js";
import { AnimatedNumber } from "./AnimatedNumber.js";

interface Props {
  meta: BaseMeta;
  position: Position;
  canWrite: boolean;
  busy: boolean;
  onDeposit: (amount: string) => void;
  onWithdraw: (amount: string) => void;
}

// Deterministic color for a token avatar, so each token reads consistently.
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 58% 52%)`;
}

const listVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const sectionVariants = {
  hidden: { opacity: 0, y: -4, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.15 } },
};

export function VaultPanel({ meta, position, canWrite, busy, onDeposit, onWithdraw }: Props) {
  const [amount, setAmount] = useState("");

  const holdingsValue = position.holdings.reduce((a, h) => a + h.currentValueBase, 0n);
  const totalValue = position.baseBalance + holdingsValue;
  const totalPnl = position.holdings.reduce((a, h) => a + h.pnlBase, 0n);
  const pnlSign = totalPnl < 0n ? "neg" : "pos";

  return (
    <>
      <div className="card">
        <div className="hero">
          <Contour />
          <div className="hero-top">
            <span className="live-dot" title="Read live from the vault contract" />
            <span className="hero-label">Total portfolio</span>
          </div>
          <div className="hero-value">
            <AnimatedNumber value={toFloat(totalValue, meta.decimals)} format={(n) => fmtFloat(n, 2)} />
            <span className="unit">{meta.symbol}</span>
          </div>
          <span className={`pnl-chip ${pnlSign}`}>
            {fmtSigned(totalPnl, meta.decimals, 2)} {meta.symbol} unrealized
          </span>

          <div className="hero-sub">
            <div>
              <span className="stat-label">Withdrawable</span>
              <span className="stat-value">{fmt(position.baseBalance, meta.decimals, 2)}</span>
            </div>
            <div>
              <span className="stat-label">In positions</span>
              <span className="stat-value">{fmt(holdingsValue, meta.decimals, 2)}</span>
            </div>
          </div>
        </div>

        {canWrite && (
          <div className="actions-row">
            <input
              placeholder={`Amount (${meta.symbol})`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
            <motion.button
              className="primary"
              disabled={busy || !amount}
              onClick={() => onDeposit(amount)}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
            >
              Deposit
            </motion.button>
            <motion.button
              disabled={busy || !amount}
              onClick={() => onWithdraw(amount)}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
            >
              Withdraw
            </motion.button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {position.holdings.length > 0 && (
          <motion.div variants={sectionVariants} initial="hidden" animate="visible" exit="exit">
            <h2>Positions</h2>
            <motion.div className="card rows" variants={listVariants} initial="hidden" animate="visible">
              <AnimatePresence initial={false}>
                {position.holdings.map((h) => (
                  <motion.div
                    className="row"
                    key={h.token}
                    variants={rowVariants}
                    exit="exit"
                    layout="position"
                  >
                    <span className="avatar" style={{ background: avatarColor(h.symbol) }}>
                      {h.symbol.slice(0, 3).toUpperCase()}
                    </span>
                    <div className="row-main">
                      <div className="row-title">{h.symbol}</div>
                      <div className="row-sub">
                        {fmt(h.amount, h.decimals, 4)} · basis {fmt(h.costBasis, meta.decimals, 2)} {meta.symbol}
                      </div>
                    </div>
                    <div className="row-right">
                      <div className="v">
                        {fmt(h.currentValueBase, meta.decimals, 2)} {meta.symbol}
                      </div>
                      <div className={`s ${h.pnlBase < 0n ? "neg" : "pos"}`}>
                        {fmtSigned(h.pnlBase, meta.decimals, 2)}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
