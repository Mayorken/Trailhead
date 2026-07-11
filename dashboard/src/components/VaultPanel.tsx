import { useState } from "react";
import type { BaseMeta, Position } from "../chain.js";
import { fmt, fmtSigned, shortAddr } from "../format.js";

interface Props {
  meta: BaseMeta;
  position: Position;
  address: string;
  canWrite: boolean;
  busy: boolean;
  onDeposit: (amount: string) => void;
  onWithdraw: (amount: string) => void;
}

export function VaultPanel({ meta, position, address, canWrite, busy, onDeposit, onWithdraw }: Props) {
  const [amount, setAmount] = useState("");

  const holdingsValue = position.holdings.reduce((acc, h) => acc + h.currentValueBase, 0n);
  const totalValue = position.baseBalance + holdingsValue;
  const totalPnl = position.holdings.reduce((acc, h) => acc + h.pnlBase, 0n);

  return (
    <div className="vault">
      <div className="vault-summary">
        <div className="stat">
          <span className="stat-label">Withdrawable ({meta.symbol})</span>
          <span className="stat-value">{fmt(position.baseBalance, meta.decimals, 2)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Open positions value</span>
          <span className="stat-value">{fmt(holdingsValue, meta.decimals, 2)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total portfolio</span>
          <span className="stat-value">{fmt(totalValue, meta.decimals, 2)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Unrealized P&amp;L</span>
          <span className={"stat-value " + (totalPnl < 0n ? "neg" : "pos")}>
            {fmtSigned(totalPnl, meta.decimals, 2)}
          </span>
        </div>
      </div>
      <p className="addr-line">Position for {shortAddr(address)}</p>

      {position.holdings.length > 0 && (
        <table className="holdings">
          <thead>
            <tr>
              <th>Token</th>
              <th>Held</th>
              <th>Cost basis ({meta.symbol})</th>
              <th>Value ({meta.symbol})</th>
              <th>P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {position.holdings.map((h) => (
              <tr key={h.token}>
                <td title={h.token}>{h.symbol}</td>
                <td>{fmt(h.amount, h.decimals, 4)}</td>
                <td>{fmt(h.costBasis, meta.decimals, 2)}</td>
                <td>{fmt(h.currentValueBase, meta.decimals, 2)}</td>
                <td className={h.pnlBase < 0n ? "neg" : "pos"}>{fmtSigned(h.pnlBase, meta.decimals, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite && (
        <div className="deposit-form">
          <input
            placeholder={`Amount (${meta.symbol})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
          <button disabled={busy || !amount} onClick={() => onDeposit(amount)}>Deposit</button>
          <button disabled={busy || !amount} onClick={() => onWithdraw(amount)}>Withdraw</button>
        </div>
      )}
    </div>
  );
}
