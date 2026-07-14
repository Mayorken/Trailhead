import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { motion, AnimatePresence } from "framer-motion";
import { config, isConfigured } from "./config.js";
import {
  readProvider,
  loadBaseMeta,
  loadStrategies,
  loadPosition,
  loadLeaderboard,
  loadActivity,
  connectWallet,
  switchToConfiguredChain,
  writeVault,
  erc20With,
  type BaseMeta,
  type LeaderboardEntry,
  type ActivityItem,
  type Position,
  type Wallet,
} from "./chain.js";
import { Leaderboard } from "./components/Leaderboard.js";
import { ActivityFeed } from "./components/ActivityFeed.js";
import { VaultPanel } from "./components/VaultPanel.js";
import { Logo } from "./components/Logo.js";
import { shortAddr } from "./format.js";

const bannerVariants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

const tap = { scale: 0.97 };
const tapTransition = { duration: 0.12, ease: [0.23, 1, 0.32, 1] as const };

const ACTIVITY_POLL_MS = 6_000;
const MAX_ACTIVITY_ITEMS = 50;
const ACTIVITY_LOOKBACK_BLOCKS = 100;

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [meta, setMeta] = useState<BaseMeta | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const symbolCacheRef = useRef<Map<string, string>>(new Map());
  const lastScannedBlockRef = useRef<number | null>(null);

  const activeAddress = wallet?.address ?? config.demoAddress;
  const canWrite = !!wallet;

  const refresh = useCallback(async () => {
    if (!isConfigured()) {
      setError("Dashboard is not configured. Set VITE_REGISTRY_ADDRESS and VITE_VAULT_ADDRESS.");
      return;
    }
    setError("");
    try {
      const provider = readProvider();
      const m = meta ?? (await loadBaseMeta(provider));
      if (!meta) setMeta(m);
      const strats = await loadStrategies(provider, activeAddress);
      if (activeAddress) setPosition(await loadPosition(provider, m, activeAddress));
      else setPosition(null);

      // Leaderboard loads async after the position to avoid blocking the hero number.
      loadLeaderboard(provider, m, strats)
        .then(setLeaderboard)
        .catch(() => setLeaderboard([]));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [activeAddress, meta]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Activity feed: incremental poll every 6 s.
  useEffect(() => {
    if (!isConfigured()) return;

    const poll = async () => {
      try {
        const provider = readProvider();
        const latest = await provider.getBlockNumber();
        const from = lastScannedBlockRef.current === null
          ? Math.max(config.vaultDeployBlock, latest - ACTIVITY_LOOKBACK_BLOCKS)
          : lastScannedBlockRef.current + 1;

        if (from > latest) return;

        const m = meta ?? (await loadBaseMeta(provider));
        const items = await loadActivity(provider, from, latest, symbolCacheRef.current, m);
        lastScannedBlockRef.current = latest;

        if (items.length > 0) {
          setActivity((prev) => {
            const merged = [...items, ...prev];
            return merged.slice(0, MAX_ACTIVITY_ITEMS);
          });
        }
      } catch {
        // polling failures are silent — feed just doesn't update this tick
      }
    };

    void poll();
    const id = setInterval(() => void poll(), ACTIVITY_POLL_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setError("");
    try {
      setWallet(await connectWallet());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const disconnect = () => {
    setWallet(null);
    setStatus("");
    setError("");
  };

  // React to wallet account/chain changes. Injected wallets can't be force-disconnected,
  // so "disconnect" clears app state; if the user disconnects in the wallet, accountsChanged
  // fires with an empty list and we do the same.
  useEffect(() => {
    const eth = window.ethereum;
    if (!wallet || !eth?.on) return;
    const onAccounts = (accts: unknown) => {
      const list = accts as string[];
      if (!list || list.length === 0) disconnect();
      else void connect();
    };
    const onChain = () => void connect();
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [wallet]);

  const wrongNetwork = wallet !== null && wallet.chainId !== config.chainId;

  const runTx = useCallback(
    async (label: string, build: (signer: ethers.Signer) => Promise<ethers.ContractTransactionResponse>) => {
      if (!wallet) return;
      setBusy(true);
      setError("");
      setStatus(`${label}: sending…`);
      try {
        const tx = await build(wallet.signer);
        setStatus(`${label}: waiting for confirmation (${shortAddr(tx.hash)})…`);
        await tx.wait();
        setStatus(`${label}: confirmed.`);
        await refresh();
      } catch (e) {
        setStatus("");
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [wallet, refresh],
  );

  const onDeposit = (amountStr: string) => {
    if (!meta || !wallet) return;
    const amount = ethers.parseUnits(amountStr, meta.decimals);
    void runTx("Deposit", async (signer) => {
      const token = erc20With(meta.baseAsset, signer);
      const allowance: bigint = await token.allowance(wallet.address, config.vaultAddress);
      if (allowance < amount) {
        const approveTx = await token.approve(config.vaultAddress, amount);
        await approveTx.wait();
      }
      return writeVault(signer).deposit(amount);
    });
  };

  const onWithdraw = (amountStr: string) => {
    if (!meta) return;
    const amount = ethers.parseUnits(amountStr, meta.decimals);
    void runTx("Withdraw", (signer) => writeVault(signer).withdraw(amount));
  };

  const onFollow = (id: bigint, slipBps: number, posBps: number) =>
    void runTx("Follow", (signer) => writeVault(signer).followStrategy(id, slipBps, posBps));

  const onUnfollow = (id: bigint) =>
    void runTx("Unfollow", (signer) => writeVault(signer).unfollowStrategy(id));

  return (
    <div className="app">
      <header>
        <Logo />
        <div className="wallet-box">
          <AnimatePresence mode="wait" initial={false}>
            {wallet ? (
              <motion.div
                key="connected"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              >
                <span className="pill" title={wallet.address}>{shortAddr(wallet.address)}</span>
                <motion.button whileTap={tap} transition={tapTransition} onClick={disconnect}>
                  Disconnect
                </motion.button>
              </motion.div>
            ) : (
              <motion.button
                key="disconnected"
                className="primary"
                onClick={connect}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                whileTap={tap}
                transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              >
                Connect wallet
              </motion.button>
            )}
          </AnimatePresence>
          <span className="net">chain {config.chainId}</span>
        </div>
      </header>

      <AnimatePresence>
        {wrongNetwork && (
          <motion.div className="error" variants={bannerVariants} initial="hidden" animate="visible" exit="exit">
            Wrong network — wallet is on chain {wallet?.chainId}, this app needs {config.chainId}.
            <motion.button
              className="inline"
              whileTap={tap}
              transition={tapTransition}
              onClick={() => void switchToConfiguredChain()}
            >
              Switch
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {error && (
          <motion.div className="error" variants={bannerVariants} initial="hidden" animate="visible" exit="exit">
            {error}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {status && (
          <motion.div className="status" variants={bannerVariants} initial="hidden" animate="visible" exit="exit">
            {status}
          </motion.div>
        )}
      </AnimatePresence>

      {meta && position && activeAddress ? (
        <VaultPanel
          meta={meta}
          position={position}
          canWrite={canWrite}
          busy={busy}
          onDeposit={onDeposit}
          onWithdraw={onWithdraw}
        />
      ) : (
        <div className="card">
          <p className="empty">
            {activeAddress ? "Loading position…" : "Connect a wallet to see your position."}
          </p>
        </div>
      )}

      <h2>Strategies</h2>
      <Leaderboard
        entries={leaderboard}
        decimals={meta?.decimals ?? 6}
        symbol={meta?.symbol ?? "USDC"}
        canWrite={canWrite}
        busy={busy}
        onFollow={onFollow}
        onUnfollow={onUnfollow}
      />

      <h2>Live Activity</h2>
      <ActivityFeed
        items={activity}
        decimals={meta?.decimals ?? 6}
        symbol={meta?.symbol ?? "USDC"}
      />

      <footer>
        <span className="mono">Registry {shortAddr(config.registryAddress)}</span>
        <span className="mono">Vault {shortAddr(config.vaultAddress)}</span>
        <span>Non-custodial · funds never leave your control</span>
      </footer>
    </div>
  );
}
