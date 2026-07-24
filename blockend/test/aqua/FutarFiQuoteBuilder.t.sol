// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ISwapVM} from "@1inch-swap-vm/src/interfaces/ISwapVM.sol";
import {BalancesArgsBuilder} from "@1inch-swap-vm/src/instructions/Balances.sol";
import {LimitSwapArgsBuilder} from "@1inch-swap-vm/src/instructions/LimitSwap.sol";
import {FutarFiQuoteBuilder} from "../../src/aqua/FutarFiQuoteBuilder.sol";

contract FutarFiQuoteBuilderTest is Test {
    FutarFiQuoteBuilder builder;

    address usdc  = address(0x1000);
    address yes   = address(0x2000); // usdc < yes -> tokenA = usdc
    address maker = address(0xBEEF);

    function setUp() public {
        builder = new FutarFiQuoteBuilder(address(0xAA00)); // aqua addr unused for building
    }

    /// Program = 3 TLV instructions: staticBalances(tokens+balances) | limitSwap(dir) | salt
    function test_buildProgram_layout() public view {
        bytes memory p = builder.buildProgram(usdc, yes, 40e6, 100e18, bytes32(uint256(7)));

        // --- instruction 0: staticBalances ---
        address[] memory tokens = new address[](2);
        tokens[0] = usdc; tokens[1] = yes;
        uint256[] memory balances = new uint256[](2);
        balances[0] = 40e6; balances[1] = 100e18;
        bytes memory expectedArgs0 = BalancesArgsBuilder.build(tokens, balances);

        uint256 o = 0;
        (uint8 op0, bytes memory args0, uint256 next0) = _tlv(p, o);
        assertEq(args0, expectedArgs0, "staticBalances args mismatch");

        // --- instruction 1: limitSwap direction byte (usdc < yes -> true) ---
        (uint8 op1, bytes memory args1, uint256 next1) = _tlv(p, next0);
        assertEq(args1, LimitSwapArgsBuilder.build(usdc, yes), "limitSwap args mismatch");
        assertEq(args1.length, 1);
        assertEq(uint8(args1[0]), 1, "direction must be tokenIn<tokenOut");

        // --- instruction 2: salt ---
        (uint8 op2, bytes memory args2, uint256 next2) = _tlv(p, next1);
        assertEq(args2, abi.encodePacked(bytes32(uint256(7))), "salt args mismatch");

        assertEq(next2, p.length, "trailing bytes after salt");
        assertTrue(op0 != op1 && op1 != op2 && op0 != op2, "opcodes must be distinct");
    }

    function test_buildProgram_sortsWhenTokenOrderReversed() public view {
        address hiUsdc = address(0x3000); // hiUsdc > yes -> tokenA = yes
        bytes memory p = builder.buildProgram(hiUsdc, yes, 40e6, 100e18, bytes32(0));

        address[] memory tokens = new address[](2);
        tokens[0] = yes; tokens[1] = hiUsdc;
        uint256[] memory balances = new uint256[](2);
        balances[0] = 100e18; balances[1] = 40e6;

        (, bytes memory args0,) = _tlv(p, 0);
        assertEq(args0, BalancesArgsBuilder.build(tokens, balances), "sorted args mismatch");
    }

    function test_buildOrder_aquaMode() public view {
        bytes memory p = builder.buildProgram(usdc, yes, 40e6, 100e18, bytes32(0));
        ISwapVM.Order memory order = builder.buildOrder(maker, p);
        assertEq(order.maker, maker);
        // With no hooks configured, order.data is exactly the program bytecode.
        assertGe(order.data.length, p.length, "data must embed program");
    }

    function test_differentSalts_differentPrograms() public view {
        bytes memory p1 = builder.buildProgram(usdc, yes, 40e6, 100e18, bytes32(uint256(1)));
        bytes memory p2 = builder.buildProgram(usdc, yes, 40e6, 100e18, bytes32(uint256(2)));
        assertTrue(keccak256(p1) != keccak256(p2));
    }

    /// Parse one [opcode:1B][len:1B][args:len] instruction at offset.
    function _tlv(bytes memory data, uint256 offset)
        private pure returns (uint8 opcode, bytes memory args, uint256 nextOffset)
    {
        opcode = uint8(data[offset]);
        uint256 len = uint8(data[offset + 1]);
        args = new bytes(len);
        for (uint256 i = 0; i < len; i++) args[i] = data[offset + 2 + i];
        nextOffset = offset + 2 + len;
    }
}
