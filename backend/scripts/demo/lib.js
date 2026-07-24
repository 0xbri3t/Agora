// Shared wiring for the Aqua demo scripts.
// Env: RPC_URL (or SEPOLIA_RPC_URL), DEPLOYER_PK (maker), TAKER_PK
// Addresses come from src/config/aqua.js (env-overridable) or .demo-state.json.
// Comments simple in English
try { require('dotenv').config(); } catch (_) {}
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const STATE_FILE = path.join(__dirname, '.demo-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}

function saveState(patch) {
  const cur = loadState();
  const next = { ...cur, ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

function rpcUrl() {
  return process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
}

function getProvider() {
  return new ethers.JsonRpcProvider(rpcUrl(), undefined, { polling: true, pollingInterval: 500 });
}

function getMaker(provider) {
  const pk = process.env.DEPLOYER_PK;
  if (!pk) throw new Error('DEPLOYER_PK env var required (maker/deployer key)');
  const w = new ethers.NonceManager(new ethers.Wallet(pk, provider));
  return w;
}

function getTaker(provider) {
  const pk = process.env.TAKER_PK;
  if (!pk) throw new Error('TAKER_PK env var required (taker key)');
  return new ethers.NonceManager(new ethers.Wallet(pk, provider));
}

/// Effective config: base config <- demo state overrides
function getCfg() {
  const base = require('../../src/config/aqua');
  const st = loadState();
  return {
    ...base,
    routerAddress: st.router || base.routerAddress,
    builderAddress: st.builder || base.builderAddress,
    usdcAddress: st.usdc || base.usdcAddress,
    yesAddress: st.yes || null,
  };
}

function explorer(txHash) {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

function artifact(rel) {
  const p = path.join(__dirname, '../../../blockend/out', rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function deployFromArtifact(wallet, artifactPath, args) {
  const art = artifact(artifactPath);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode.object, wallet);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

module.exports = {
  loadState, saveState, getProvider, getMaker, getTaker, getCfg,
  explorer, deployFromArtifact, rpcUrl,
};
