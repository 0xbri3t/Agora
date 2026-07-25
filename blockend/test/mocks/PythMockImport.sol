// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// The backend fork tests deploy Pyth's MockPyth from its forge artifact.
// Nothing in Solidity imports it, so this file exists to keep it in the
// compilation set (out/MockPyth.sol/MockPyth.json).
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
