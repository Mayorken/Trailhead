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

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 50%)`;
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
        className="primary"
        disabled={busy}
        onClick={() => onFollow(id, Math.round(Number(slipPct) * 100), Math.round(Number(posPct) * 100))}
      >
        Confirm follow
      </button>
      <span className="hint">caps: 5% / 50%</span>
    </div>
  );
}

export function Strategies({ strategies, canWrite, busy, onFollow, onUnfollow }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (strategies.length === 0) return <div className="card"><p className="empty">No strategies registered yet.</p></div>;

  return (
    <div className="card rows">
      {strategies.map((s, i) => {
        const key = s.id.toString();
        const following = !!s.follow?.active;
        return (
          <Fragment key={key}>
            <div
              className={`row ${s.active ? "" : "inactive"}`}
              style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
            >
              <span className="avatar" style={{ background: avatarColor(s.strategyWallet) }}>
                {key}
              </span>
              <div className="row-main">
                <div className="row-title">
                  {shortAddr(s.strategyWallet)}
                  {s.verified && <span className="badge verified">✓ verified</span>}
                  {following && <span className="badge following">following</span>}
                </div>
                <div className="row-sub">
                  {bpsToPct(s.profitShareBps)} profit share · {s.active ? "active" : "inactive"}
                </div>
              </div>
              <div className="row-right">
                {!canWrite ? (
                  <span className="hint">connect wallet</span>
                ) : following ? (
                  <button disabled={busy} onClick={() => onUnfollow(s.id)}>Unfollow</button>
                ) : s.active ? (
                  <button disabled={busy} onClick={() => setOpenId(openId === key ? null : key)}>
                    {openId === key ? "Cancel" : "Follow"}
                  </button>
                ) : null}
              </div>
            </div>
            {canWrite && openId === key && !following && (
              <FollowForm id={s.id} busy={busy} onFollow={onFollow} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
