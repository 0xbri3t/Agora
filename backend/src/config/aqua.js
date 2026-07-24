// Aqua/SwapVM deployment config.
// Env vars take precedence (tests, overrides); falls back to blockend deployments file.
try { require('dotenv').config(); } catch (_) {}

let fileCfg = {};
try {
  // Written by blockend DeployAquaStack broadcast (Task: deploy Sepolia stack)
  fileCfg = require('../../../blockend/deployments/sepolia-aqua.json');
} catch (_) { /* not deployed yet — env vars must provide addresses */ }

module.exports = {
  chainId: Number(process.env.AQUA_CHAIN_ID || fileCfg.chainId || 11155111),
  aquaAddress: process.env.AQUA_CORE_ADDRESS || fileCfg.aqua || '0x499943E74FB0cE105688beeE8Ef2ABec5D936d31',
  routerAddress: process.env.AQUA_ROUTER_ADDRESS || fileCfg.router || '',
  builderAddress: process.env.AQUA_BUILDER_ADDRESS || fileCfg.builder || '',
  usdcAddress: process.env.AQUA_USDC_ADDRESS || fileCfg.usdc || '',
};
