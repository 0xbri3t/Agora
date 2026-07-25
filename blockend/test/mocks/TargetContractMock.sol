// SPDX-License-Identifier: MIT

pragma solidity ^0.8.30;

contract TargetContractMock {
    bool public flag = false;

    function setTrue() external {
        flag = true;
    }
}