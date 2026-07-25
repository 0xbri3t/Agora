// SPDX-License-Identifier: MIT

pragma solidity ^0.8.30;

import {Proposal} from "../core/Proposal.sol";

interface IProposalManager {

    struct ProposalInfo {
        uint256 id;
        address admin;
        string title;
        string description;
        Proposal.State state;
        uint256 auctionStartTime;
        uint256 auctionEndTime;
        uint256 liveStart;
        uint256 liveEnd;
        uint256 liveDuration;
        string subjectToken;
        uint256 minToOpen;
        uint256 maxCap;
        address yesAuction;
        address noAuction;
        address yesToken;
        address noToken;
        address treasury;
        address target;
        bytes data;
        address proposalAddress;
    }

    function createProposal(
        string memory _title,
        string memory _description,
        uint256 _auctionDuration,
        uint256 _liveDuration,
        string memory _subjectToken,
        uint256 _minToOpen,
        uint256 _maxCap,
        address _target,
        bytes memory _data,
        address _pythAddr,
        bytes32 _pythId
    ) external returns (uint256);

    function finalizeProposal(uint256 _proposalId) external;
    function getProposalById(uint256 _proposalId) external view returns (ProposalInfo memory);
    function getAllProposals() external view returns (ProposalInfo[] memory proposals);
    function deleteProposal(address _proposal) external;
    function getProposalsByAdmin(address _admin) external view returns (ProposalInfo[] memory);
}