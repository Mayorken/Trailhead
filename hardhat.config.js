require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { PRIVATE_KEY, FUJI_RPC_URL, AVALANCHE_RPC_URL, SNOWTRACE_API_KEY } = process.env;

const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

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
