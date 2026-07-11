import { ethers } from "ethers";
import { registryAbi, vaultAbi, routerAbi, erc20Abi } from "./abis.js";
import type { AgentConfig } from "./config.js";

export interface Chain {
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
  registry: ethers.Contract;
  vault: ethers.Contract;
  router: ethers.Contract;
  routerAddress: string;
  baseAsset: string;
  routerInterface: ethers.Interface;
  erc20(address: string): ethers.Contract;
}

/** Connect providers/contracts and assert the agent wallet is the vault's executionAgent. */
export async function connectChain(cfg: AgentConfig): Promise<Chain> {
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet = new ethers.Wallet(cfg.agentPrivateKey, provider);

  const registry = new ethers.Contract(cfg.registryAddress, registryAbi, wallet);
  const vault = new ethers.Contract(cfg.vaultAddress, vaultAbi, wallet);

  const baseAsset: string = await vault.baseAsset();
  const routerAddress: string = await vault.router();
  const onChainAgent: string = await vault.executionAgent();

  if (onChainAgent.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(
      `Agent wallet ${wallet.address} is not the vault's executionAgent (${onChainAgent}). ` +
        `Call setExecutionAgent from the owner first.`,
    );
  }

  const router = new ethers.Contract(routerAddress, routerAbi, wallet);

  return {
    provider,
    wallet,
    registry,
    vault,
    router,
    routerAddress,
    baseAsset,
    routerInterface: new ethers.Interface(routerAbi),
    erc20: (address: string) => new ethers.Contract(address, erc20Abi, wallet),
  };
}
