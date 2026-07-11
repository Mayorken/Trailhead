import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { config, isConfigured } from "./config.js";
import {
  readProvider,
  loadBaseMeta,
  loadStrategies,
  loadPosition,
  connectWallet,
  switchToConfiguredChain,
  writeVault,
  erc20With,
  type BaseMeta,
  type Strategy,
  type Position,
  type Wallet,
} from "./chain.js";
import { Strategies } from "./components/Strategies.js";
import { VaultPanel } from "./components/VaultPanel.js";
import { shortAddr } from "./format.js";

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [meta, setMeta] = useState<BaseMeta | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

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
      setStrategies(await loadStrategies(provider, activeAddress));
      if (activeAddress) setPosition(await loadPosition(provider, m, activeAddress));
      else setPosition(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [activeAddress, meta]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        <div>
          <h1>Trailhead</h1>
          <p className="tagline">On-chain copy-trading · Avalanche</p>
        </div>
        <div className="wallet-box">
          {wallet ? (
            <>
              <span className="pill" title={wallet.address}>{shortAddr(wallet.address)}</span>
              <button onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <button className="primary" onClick={connect}>Connect wallet</button>
          )}
          <span className="net">chain {config.chainId}</span>
        </div>
      </header>

      {wrongNetwork && (
        <div className="error">
          Wrong network — your wallet is on chain {wallet?.chainId}, this app needs {config.chainId}.
          <button className="inline" onClick={() => void switchToConfiguredChain()}>Switch network</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}

      <section>
        <h2>Your vault</h2>
        {meta && position && activeAddress ? (
          <VaultPanel
            meta={meta}
            position={position}
            address={activeAddress}
            canWrite={canWrite}
            busy={busy}
            onDeposit={onDeposit}
            onWithdraw={onWithdraw}
          />
        ) : (
          <p className="empty">
            {activeAddress ? "Loading position…" : "Connect a wallet to see your position."}
          </p>
        )}
      </section>

      <section>
        <h2>Strategies</h2>
        <Strategies
          strategies={strategies}
          canWrite={canWrite}
          busy={busy}
          onFollow={onFollow}
          onUnfollow={onUnfollow}
        />
      </section>

      <footer>
        <span>Registry {shortAddr(config.registryAddress)}</span>
        <span>Vault {shortAddr(config.vaultAddress)}</span>
        <span>Non-custodial · funds never leave your control</span>
      </footer>
    </div>
  );
}
