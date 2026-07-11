import { useState } from "react";
import type { BaseMeta, Position } from "../chain.js";
import { fmt, fmtSigned } from "../format.js";

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
          <span className="hero-label">Total portfolio</span>
          <div className="hero-value">
            {fmt(totalValue, meta.decimals, 2)}
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
            <button className="primary" disabled={busy || !amount} onClick={() => onDeposit(amount)}>
              Deposit
            </button>
            <button disabled={busy || !amount} onClick={() => onWithdraw(amount)}>
              Withdraw
            </button>
          </div>
        )}
      </div>

      {position.holdings.length > 0 && (
        <>
          <h2>Positions</h2>
          <div className="card rows">
            {position.holdings.map((h) => (
              <div className="row" key={h.token}>
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
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
