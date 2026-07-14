import { motion, AnimatePresence } from "framer-motion";
import type { ActivityItem } from "../chain.js";
import { shortAddr, fmt } from "../format.js";

interface Props {
  items: ActivityItem[];
  decimals: number;
  symbol: string;
}

const SNOWTRACE = "https://testnet.snowtrace.io/tx/";

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, x: 10, transition: { duration: 0.15 } },
};

export function ActivityFeed({ items, decimals, symbol }: Props) {
  return (
    <div className="card activity-feed">
      {items.length === 0 ? (
        <p className="empty">Watching for trades… (polls every 6 s)</p>
      ) : (
        <div className="feed-scroll">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const isOpen = item.type === "open";
              const tokenAmt = fmt(item.tokenAmount, 18, 4); // held token is 18-dec (WAVAX etc)
              const baseAmt  = fmt(item.baseAmount, decimals, 4);
              const label    = isOpen
                ? `Bought ${tokenAmt} ${item.tokenSymbol} for ${baseAmt} ${symbol}`
                : `Sold ${tokenAmt} ${item.tokenSymbol} → ${baseAmt} ${symbol}`;

              return (
                <motion.div
                  key={`${item.txHash}-${item.type}`}
                  className="feed-item"
                  variants={itemVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  layout
                >
                  <span className={`feed-pill ${isOpen ? "buy" : "sell"}`}>
                    {isOpen ? "BUY" : "SELL"}
                  </span>
                  <div className="feed-body">
                    <span className="feed-desc">{label}</span>
                    <span className="feed-meta">
                      {shortAddr(item.follower)} · strategy {item.strategyId.toString()} ·{" "}
                      <a
                        href={`${SNOWTRACE}${item.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="feed-link"
                      >
                        block {item.block}
                      </a>
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
