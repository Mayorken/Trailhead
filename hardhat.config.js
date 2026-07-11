require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { PRIVATE_KEY, FUJI_RPC_URL, AVALANCHE_RPC_URL, SNOWTRACE_API_KEY } = process.env;

// Accept a PRIVATE_KEY only if it's a valid 32-byte hex key; otherwise disable live-network
// accounts rather than crashing the whole config (so `hardhat node` / tests still run).
function normalizePrivateKey(k) {
  if (!k || k.trim() === "") return null;
  const key = k.trim().startsWith("0x") ? k.trim() : "0x" + k.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(key)) return key;
  console.warn("Warning: PRIVATE_KEY is not a valid 32-byte hex key — live-network accounts disabled.");
  return null;
}

const pk = normalizePrivateKey(PRIVATE_KEY);
const accounts = pk ? [pk] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    fuji: {
      url: FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts,
    },
    avalanche: {
      url: AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      accounts,
    },
  },
  etherscan: {
    // Snowtrace verification (routed through Etherscan v2 multichain API keys).
    apiKey: {
      avalancheFujiTestnet: SNOWTRACE_API_KEY || "",
      avalanche: SNOWTRACE_API_KEY || "",
    },
  },
};
