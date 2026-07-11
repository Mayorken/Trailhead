import { Fragment, useState } from "react";
import type { Strategy } from "../chain.js";
import { shortAddr, bpsToPct } from "../format.js";

interface Props {
  strategies: Strategy[];
  canWrite: boolean;
  busy: boolean;
  onFollow: (id: bigint, maxSlippageBps: number, maxPositionSizeBps: number) => void;
  onUnfollow: (id: bigint) => void;
}

function FollowForm({ id, busy, onFollow }: { id: bigint; busy: boolean; onFollow: Props["onFollow"] }) {
  const [slipPct, setSlipPct] = useState("3");
  const [posPct, setPosPct] = useState("25");
  return (
    <div className="follow-form">
      <label>
        Max slippage %
        <input value={slipPct} onChange={(e) => setSlipPct(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Max position %
        <input value={posPct} onChange={(e) => setPosPct(e.target.value)} inputMode="decimal" />
      </label>
      <button
        disabled={busy}
        onClick={() => onFollow(id, Math.round(Number(slipPct) * 100), Math.round(Number(posPct) * 100))}
      >
        Follow
      </button>
      <span className="hint">caps: 5% slippage / 50% position</span>
    </div>
  );
}

export function Strategies({ strategies, canWrite, busy, onFollow, onUnfollow }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (strategies.length === 0) return <p className="empty">No strategies registered yet.</p>;

  return (
    <table className="strategies">
      <thead>
        <tr>
          <th>#</th>
          <th>Strategy wallet</th>
          <th>Profit share</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {strategies.map((s) => {
          const key = s.id.toString();
          const following = !!s.follow?.active;
          return (
            <Fragment key={key}>
              <tr className={s.active ? "" : "inactive"}>
                <td>{key}</td>
                <td title={s.strategyWallet}>
                  {shortAddr(s.strategyWallet)}
                  {s.verified && <span className="badge verified" title="Admin-reviewed">✓ verified</span>}
                </td>
                <td>{bpsToPct(s.profitShareBps)}</td>
                <td>
                  {s.active ? <span className="badge active">active</span> : <span className="badge off">inactive</span>}
                  {following && <span className="badge following">following</span>}
                </td>
                <td className="actions">
                  {!canWrite ? (
                    <span className="hint">connect wallet</span>
                  ) : following ? (
                    <button disabled={busy} onClick={() => onUnfollow(s.id)}>Unfollow</button>
                  ) : s.active ? (
                    <button disabled={busy} onClick={() => setOpenId(openId === key ? null : key)}>
                      {openId === key ? "Cancel" : "Follow"}
                    </button>
                  ) : null}
                </td>
              </tr>
              {canWrite && openId === key && !following && (
                <tr className="form-row">
                  <td colSpan={5}>
                    <FollowForm id={s.id} busy={busy} onFollow={onFollow} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
