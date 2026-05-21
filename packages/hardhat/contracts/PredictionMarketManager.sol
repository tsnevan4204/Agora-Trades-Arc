// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ERC2771Context } from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import { Context } from "@openzeppelin/contracts/utils/Context.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MarketFactory } from "./MarketFactory.sol";
import { OutcomeToken1155 } from "./OutcomeToken1155.sol";

contract PredictionMarketManager is Ownable, ReentrancyGuard, ERC2771Context {
    error PredictionMarketManager__InvalidMarket();
    error PredictionMarketManager__MarketClosed();
    error PredictionMarketManager__MarketResolved();
    error PredictionMarketManager__NotResolver();
    error PredictionMarketManager__ZeroAddress();
    error PredictionMarketManager__ZeroAmount();
    error PredictionMarketManager__NoWinningTokens();
    error PredictionMarketManager__TransferFailed();
    error PredictionMarketManager__MarketNotResolved();

    enum Outcome {
        YES,
        NO
    }

    enum MarketStatus {
        Open,
        Resolved
    }

    struct MarketState {
        // totalShares tracks net paired shares collateralized in the manager vault:
        // increases on split, decreases on merge.
        MarketStatus status;
        Outcome winningOutcome;
        uint256 totalShares;
    }

    // 6-decimal fixed-point policy:
    // 1 full share = 1_000_000 units, aligned with USDC-style collateral (6 decimals).
    uint256 public constant SHARE_SCALE = 1e6;
    uint256 public constant COLLATERAL_SCALE = 1e6;

    IERC20 public immutable collateralToken;
    MarketFactory public immutable factory;
    OutcomeToken1155 public immutable outcomeToken;
    address public resolver;

    mapping(uint256 => MarketState) public markets;

    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);
    event Split(address indexed user, uint256 indexed marketId, uint256 amount);
    event Merge(address indexed user, uint256 indexed marketId, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, bytes32 evidenceHash, address indexed resolver);
    event Redeemed(address indexed user, uint256 indexed marketId, uint256 amount);

    constructor(
        address initialOwner,
        address trustedForwarder,
        address collateral,
        address factoryAddress,
        address tokenAddress,
        address initialResolver
    )
        Ownable(initialOwner)
        ERC2771Context(trustedForwarder)
    {
        if (trustedForwarder == address(0)) revert PredictionMarketManager__ZeroAddress();
        if (collateral == address(0)) revert PredictionMarketManager__ZeroAddress();
        if (factoryAddress == address(0)) revert PredictionMarketManager__ZeroAddress();
        if (tokenAddress == address(0)) revert PredictionMarketManager__ZeroAddress();
        if (initialResolver == address(0)) revert PredictionMarketManager__ZeroAddress();
        collateralToken = IERC20(collateral);
        factory = MarketFactory(factoryAddress);
        outcomeToken = OutcomeToken1155(tokenAddress);
        resolver = initialResolver;
    }

    function setResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert PredictionMarketManager__ZeroAddress();
        address old = resolver;
        resolver = newResolver;
        emit ResolverUpdated(old, newResolver);
    }

    function split(uint256 marketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert PredictionMarketManager__ZeroAmount();
        _requireMarketOpen(marketId);

        address user = _msgSender();
        bool ok = collateralToken.transferFrom(user, address(this), amount);
        if (!ok) revert PredictionMarketManager__TransferFailed();

        outcomeToken.mint(user, outcomeToken.getYesTokenId(marketId), amount);
        outcomeToken.mint(user, outcomeToken.getNoTokenId(marketId), amount);
        markets[marketId].totalShares += amount;
        emit Split(user, marketId, amount);
    }

    function merge(uint256 marketId, uint256 amount) external nonReentrant {
        if (amount == 0) revert PredictionMarketManager__ZeroAmount();
        _requireMarketOpen(marketId);

        address user = _msgSender();
        outcomeToken.burn(user, outcomeToken.getYesTokenId(marketId), amount);
        outcomeToken.burn(user, outcomeToken.getNoTokenId(marketId), amount);

        markets[marketId].totalShares -= amount;
        bool ok = collateralToken.transfer(user, amount);
        if (!ok) revert PredictionMarketManager__TransferFailed();
        emit Merge(user, marketId, amount);
    }

    function resolve(uint256 marketId, Outcome outcome, bytes32 evidenceHash) external nonReentrant {
        if (_msgSender() != resolver) revert PredictionMarketManager__NotResolver();
        _requireMarketExists(marketId);
        MarketState storage state = markets[marketId];
        if (state.status == MarketStatus.Resolved) revert PredictionMarketManager__MarketResolved();
        if (block.timestamp < factory.getMarketCloseTime(marketId)) revert PredictionMarketManager__MarketClosed();

        state.status = MarketStatus.Resolved;
        state.winningOutcome = outcome;
        emit MarketResolved(marketId, outcome, evidenceHash, _msgSender());
    }

    function redeem(uint256 marketId) external nonReentrant {
        _requireMarketExists(marketId);
        MarketState memory state = markets[marketId];
        if (state.status != MarketStatus.Resolved) revert PredictionMarketManager__MarketNotResolved();

        uint256 winningId =
            state.winningOutcome == Outcome.YES ? outcomeToken.getYesTokenId(marketId) : outcomeToken.getNoTokenId(marketId);
        address user = _msgSender();
        uint256 bal = outcomeToken.balanceOf(user, winningId);
        if (bal == 0) revert PredictionMarketManager__NoWinningTokens();

        outcomeToken.burn(user, winningId, bal);
        bool ok = collateralToken.transfer(user, bal);
        if (!ok) revert PredictionMarketManager__TransferFailed();
        emit Redeemed(user, marketId, bal);
    }

    function isMarketOpenForTrading(uint256 marketId) external view returns (bool) {
        if (!factory.marketExists(marketId)) return false;
        MarketState memory state = markets[marketId];
        if (state.status == MarketStatus.Resolved) return false;
        return block.timestamp < factory.getMarketCloseTime(marketId);
    }

    function _requireMarketExists(uint256 marketId) internal view {
        if (!factory.marketExists(marketId)) revert PredictionMarketManager__InvalidMarket();
    }

    function _requireMarketOpen(uint256 marketId) internal view {
        _requireMarketExists(marketId);
        if (markets[marketId].status == MarketStatus.Resolved) revert PredictionMarketManager__MarketResolved();
        if (block.timestamp >= factory.getMarketCloseTime(marketId)) revert PredictionMarketManager__MarketClosed();
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address sender) {
        sender = ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}

