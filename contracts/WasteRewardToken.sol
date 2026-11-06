// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title WasteRewardToken
/// @notice ERC-20 rewards for verified recyclable waste deposits. Only the owner/oracle may record deposits.
contract WasteRewardToken is ERC20, Ownable {
    uint256 public constant TOKENS_PER_KILOGRAM = 10;
    uint256 public constant GRAMS_PER_KILOGRAM = 1_000;

    struct WasteDeposit {
        uint256 depositId;
        address citizen;
        string wasteType;
        uint256 weightInGrams;
        uint256 timestamp;
    }

    uint256 public nextDepositId = 1;
    mapping(uint256 => WasteDeposit) public deposits;
    mapping(address => uint256[]) private citizenDepositIds;
    uint256 public totalWeightInGrams;

    event DepositRecorded(uint256 indexed depositId, address indexed citizen, string wasteType, uint256 weightInGrams, uint256 reward);

    constructor() ERC20("RecycleToken", "RCT") Ownable(msg.sender) {}

    /// @notice Records one oracle-verified deposit and mints 10 RCT per full kg, prorated by gram.
    function recordDeposit(address citizen, string calldata wasteType, uint256 weightInGrams) external onlyOwner returns (uint256 depositId) {
        require(citizen != address(0), "Invalid citizen");
        require(bytes(wasteType).length > 0 && bytes(wasteType).length <= 32, "Invalid waste type");
        require(weightInGrams > 0 && weightInGrams <= 1_000_000, "Invalid weight");

        depositId = nextDepositId++;
        uint256 reward = (weightInGrams * TOKENS_PER_KILOGRAM * 10 ** decimals()) / GRAMS_PER_KILOGRAM;
        deposits[depositId] = WasteDeposit(depositId, citizen, wasteType, weightInGrams, block.timestamp);
        citizenDepositIds[citizen].push(depositId);
        totalWeightInGrams += weightInGrams;
        _mint(citizen, reward);
        emit DepositRecorded(depositId, citizen, wasteType, weightInGrams, reward);
    }

    function getCitizenDepositIds(address citizen) external view returns (uint256[] memory) {
        return citizenDepositIds[citizen];
    }
}
