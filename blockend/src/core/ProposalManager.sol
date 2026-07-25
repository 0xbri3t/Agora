// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IProposal} from "../interfaces/IProposal.sol";
import {Proposal} from "./Proposal.sol";
import {IProposalManager} from "../interfaces/IProposalManager.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @title ProposalManager
/// @notice Deploys Proposal contracts and indexes them for discovery by ID and admin.

contract ProposalManager is Ownable, IProposalManager {
    address public immutable PYUSD;       // Collateral/stable used by auctions/treasury
    address public immutable ATTESTOR; 
    address public proposalImpl;

    // --- Indexing ---
    uint256 public nextId;
    address[] public allProposals;
    mapping(uint256 => address) public proposals;              // id => proposal address

    // --- Events ---
    event ProposalCreated(uint256 indexed id, address indexed admin, address proposal, string title);

    constructor(address _pyusd, address _proposalImpl, address _attestor) Ownable(msg.sender) {
        require(_pyusd != address(0), "PM:PYUSD=0");
        PYUSD = _pyusd;
        proposalImpl = _proposalImpl;
        ATTESTOR = _attestor;
    }

    /// @param _title Proposal title
    /// @param _description Text description
    /// @param _auctionDuration Auction duration in seconds (also used as Live duration for now)
    /// @param _liveDuration Live duration in seconds
    /// @param _subjectToken Subject token under evaluation (treated as subjectToken)
    /// @param _maxCap Max cap for each market token (18 decimals)
    /// @param _target Unused placeholder (kept for ABI compatibility)
    /// @param _data Unused placeholder (kept for ABI compatibility)
    /// @param _pythAddr Unused placeholder (kept for ABI compatibility)
    /// @param _pythId Unused placeholder (kept for ABI compatibility)
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
    ) external returns (uint256 id) {
        require(_auctionDuration > 0, "PM:duration=0");
        require(_liveDuration > 0, "PM:duration=0");
        require(_maxCap > 0, "PM:max=0");

        id = ++nextId;

        // deploy a new Proposal
        address proposalClone = Clones.clone(proposalImpl);
        Proposal(proposalClone).initialize(
            id,
            msg.sender,
            _title,
            _description,
            _auctionDuration,
            _liveDuration,
            _subjectToken,
            PYUSD,
            _minToOpen,
            _maxCap,
            _target,
            _data,
            _pythAddr,
            _pythId,
            ATTESTOR
        );
      

        // Indexing
        address proposalAddr = address(Proposal(proposalClone));
        proposals[id] = proposalAddr;
        allProposals.push(proposalAddr);
        emit ProposalCreated(id, msg.sender, proposalAddr, _title);
    }

    /// @notice Proxy a finalize/settle step to the proposal during the Auction phase.
    /// @dev Current Proposal exposes settleAuctions(); this triggers state transition if ready.
    function finalizeProposal(uint256 _proposalId) external {
        address proposal = proposals[_proposalId];
        require(proposal != address(0), "PM:unknown-id");
        IProposal(proposal).settleAuctions();
    }

    // --- Views (ABI compatibility with frontend) ---
    function getProposalById(uint256 _proposalId) external view returns (ProposalInfo memory) {
        address proposal = proposals[_proposalId];
        if (proposal == address(0)) revert ("PM:unknown-id");
        return ProposalInfo({
            id: IProposal(proposal).id(),
            admin: IProposal(proposal).admin(),
            title: IProposal(proposal).title(),
            description: IProposal(proposal).description(),
            state: IProposal(proposal).state(),
            auctionStartTime: IProposal(proposal).auctionStartTime(),
            auctionEndTime: IProposal(proposal).auctionEndTime(),
            liveStart: IProposal(proposal).liveStart(),
            liveEnd: IProposal(proposal).liveEnd(),
            liveDuration: IProposal(proposal).liveDuration(),
            subjectToken: IProposal(proposal).subjectToken(),
            minToOpen: IProposal(proposal).minToOpen(),
            maxCap: IProposal(proposal).maxCap(),
            yesAuction: address(IProposal(proposal).yesAuction()),
            noAuction: address(IProposal(proposal).noAuction()),
            yesToken: address(IProposal(proposal).yesToken()),
            noToken: address(IProposal(proposal).noToken()),
            treasury: address(IProposal(proposal).treasury()),
            target: address(IProposal(proposal).target()),
            data: IProposal(proposal).data(),
            proposalAddress: proposal
        });
        
    }

    function getAllProposals() external view returns (ProposalInfo[] memory _proposals) {
        _proposals = new ProposalInfo[](allProposals.length);
        for (uint256 i = 0; i < allProposals.length; i++) {
            address proposal = allProposals[i];
            _proposals[i] = ProposalInfo({
                id: IProposal(proposal).id(),
                admin: IProposal(proposal).admin(),
                title: IProposal(proposal).title(),
                description: IProposal(proposal).description(),
                state: IProposal(proposal).state(),
                auctionStartTime: IProposal(proposal).auctionStartTime(),
                auctionEndTime: IProposal(proposal).auctionEndTime(),
                liveStart: IProposal(proposal).liveStart(),
                liveEnd: IProposal(proposal).liveEnd(),
                liveDuration: IProposal(proposal).liveDuration(),
                subjectToken: IProposal(proposal).subjectToken(),
                minToOpen: IProposal(proposal).minToOpen(),
                maxCap: IProposal(proposal).maxCap(),
                yesAuction: address(IProposal(proposal).yesAuction()),
                noAuction: address(IProposal(proposal).noAuction()),
                yesToken: address(IProposal(proposal).yesToken()),
                noToken: address(IProposal(proposal).noToken()),
                treasury: address(IProposal(proposal).treasury()),
                target: address(IProposal(proposal).target()),
                data: IProposal(proposal).data(),
                proposalAddress: proposal
            });
        }
    }

    // only the creator of the proposal or the owner of the ProposalManager can delete a proposal from the index
    function deleteProposal(address _proposal) external {
        require(_proposal != address(0), "PM:zero-address");
        if (msg.sender != IProposal(_proposal).admin() && msg.sender != owner()) revert ("PM:not-authorized");

        uint256 proposalId = IProposal(_proposal).id();
        require(proposals[proposalId] == _proposal, "PM:invalid-proposal");
        delete proposals[proposalId];

        // Remove from allProposals array
        for (uint256 i = 0; i < allProposals.length; i++) {
            if (allProposals[i] == _proposal) {
                allProposals[i] = allProposals[allProposals.length - 1];
                allProposals.pop();
                break;
            }
        }
    }

    function getProposalsByAdmin(address _admin) external view returns (ProposalInfo[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allProposals.length; i++) {
            if (IProposal(allProposals[i]).admin() == _admin) count++;
        }
        ProposalInfo[] memory result = new ProposalInfo[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allProposals.length; i++) {
            address p = allProposals[i];
            if (IProposal(p).admin() == _admin) result[j++] = ProposalInfo({
                id: IProposal(p).id(),
                admin: IProposal(p).admin(),
                title: IProposal(p).title(),
                description: IProposal(p).description(),
                state: IProposal(p).state(),
                auctionStartTime: IProposal(p).auctionStartTime(),
                auctionEndTime: IProposal(p).auctionEndTime(),
                liveStart: IProposal(p).liveStart(),
                liveEnd: IProposal(p).liveEnd(),
                liveDuration: IProposal(p).liveDuration(),
                subjectToken: IProposal(p).subjectToken(),
                minToOpen: IProposal(p).minToOpen(),
                maxCap: IProposal(p).maxCap(),
                yesAuction: address(IProposal(p).yesAuction()),
                noAuction: address(IProposal(p).noAuction()),
                yesToken: address(IProposal(p).yesToken()),
                noToken: address(IProposal(p).noToken()),
                treasury: address(IProposal(p).treasury()),
                target: address(IProposal(p).target()),
                data: IProposal(p).data(),
                proposalAddress: p
            });
        }
        return result;
    }
}
