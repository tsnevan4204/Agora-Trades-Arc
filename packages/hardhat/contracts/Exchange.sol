// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ERC2771Context } from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import { Context } from "@openzeppelin/contracts/utils/Context.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import { PredictionMarketManager } from "./PredictionMarketManager.sol";
import { OutcomeToken1155 } from "./OutcomeToken1155.sol";

contract Exchange is Ownable, ReentrancyGuard, ERC2771Context, ERC1155Holder {
    error Exchange__InvalidOffer();
    error Exchange__InactiveOffer();
    error Exchange__NotMaker();
    error Exchange__InvalidPrice();
    error Exchange__InvalidAmount();
    error Exchange__MarketClosed();
    error Exchange__SelfFillNotAllowed();
    error Exchange__TransferFailed();
    error Exchange__QuoteTooSmall();
    error Exchange__PostingPaused();
    error Exchange__FillingPaused();

    enum Side {
        BUY_YES,
        BUY_NO,
        SELL_YES,
        SELL_NO
    }

    enum OfferStatus {
        Active,
        Cancelled,
        Filled
    }

    struct Offer {
        address maker;
        uint256 marketId;
        Side side;
        uint256 price;
        uint256 initialAmount;
        uint256 remainingAmount;
        OfferStatus status;
    }

    // 6-decimal fixed-point policy:
    // - amount is share units (1e6 = 1 full share)
    // - collateral token uses 1e6 base units
    // - price is in basis points (10_000 = 1.00)
    uint256 public constant SHARE_SCALE = 1e6;
    uint256 public constant COLLATERAL_SCALE = 1e6;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_OFFER_SIZE = 1;

    IERC20 public immutable collateralToken;
    IERC1155 public immutable outcomeToken;
    PredictionMarketManager public immutable manager;
    OutcomeToken1155 public immutable outcomeTokenWithHelpers;

    uint256 public nextOfferId;
    bool public postingPaused;
    bool public fillingPaused;
    mapping(uint256 => Offer) public offers;

    event OfferPosted(
        uint256 indexed offerId, address indexed maker, uint256 indexed marketId, Side side, uint256 price, uint256 amount
    );
    event OfferFilled(
        uint256 indexed offerId,
        address indexed maker,
        address indexed taker,
        uint256 fillAmount,
        uint256 price,
        uint256 totalCollateral
    );
    event OfferCancelled(uint256 indexed offerId, address indexed maker);
    event PostingPausedSet(bool paused);
    event FillingPausedSet(bool paused);

    constructor(
        address initialOwner,
        address trustedForwarder,
        address collateral,
        address token1155,
        address managerAddress
    )
        Ownable(initialOwner)
        ERC2771Context(trustedForwarder)
    {
        collateralToken = IERC20(collateral);
        outcomeToken = IERC1155(token1155);
        outcomeTokenWithHelpers = OutcomeToken1155(token1155);
        manager = PredictionMarketManager(managerAddress);
    }

    function postOffer(uint256 marketId, Side side, uint256 price, uint256 amount) external nonReentrant returns (uint256) {
        if (postingPaused) revert Exchange__PostingPaused();
        if (price == 0 || price > BPS_DENOMINATOR) revert Exchange__InvalidPrice();
        if (amount < MIN_OFFER_SIZE) revert Exchange__InvalidAmount();
        if (!manager.isMarketOpenForTrading(marketId)) revert Exchange__MarketClosed();

        address maker = _msgSender();
        if (_isSell(side)) {
            uint256 tokenId = _tokenIdForSide(marketId, side);
            outcomeToken.safeTransferFrom(maker, address(this), tokenId, amount, "");
        } else {
            uint256 totalCollateral = _getTotalPrice(amount, price);
            if (totalCollateral == 0) revert Exchange__QuoteTooSmall();
            bool ok = collateralToken.transferFrom(maker, address(this), totalCollateral);
            if (!ok) revert Exchange__TransferFailed();
        }

        uint256 offerId = nextOfferId++;
        offers[offerId] = Offer({
            maker: maker,
            marketId: marketId,
            side: side,
            price: price,
            initialAmount: amount,
            remainingAmount: amount,
            status: OfferStatus.Active
        });
        emit OfferPosted(offerId, maker, marketId, side, price, amount);
        return offerId;
    }

    function fillOffer(uint256 offerId, uint256 fillAmount) external nonReentrant {
        if (fillingPaused) revert Exchange__FillingPaused();
        Offer storage offer = offers[offerId];
        if (offer.maker == address(0)) revert Exchange__InvalidOffer();
        if (offer.status != OfferStatus.Active) revert Exchange__InactiveOffer();
        if (fillAmount == 0 || fillAmount > offer.remainingAmount) revert Exchange__InvalidAmount();
        if (!manager.isMarketOpenForTrading(offer.marketId)) revert Exchange__MarketClosed();
        address taker = _msgSender();
        if (taker == offer.maker) revert Exchange__SelfFillNotAllowed();

        offer.remainingAmount -= fillAmount;
        if (offer.remainingAmount == 0) {
            offer.status = OfferStatus.Filled;
        }

        uint256 totalCollateral = _getTotalPrice(fillAmount, offer.price);
        if (totalCollateral == 0) revert Exchange__QuoteTooSmall();
        if (_isSell(offer.side)) {
            uint256 tokenId = _tokenIdForSide(offer.marketId, offer.side);
            bool ok = collateralToken.transferFrom(taker, offer.maker, totalCollateral);
            if (!ok) revert Exchange__TransferFailed();
            outcomeToken.safeTransferFrom(address(this), taker, tokenId, fillAmount, "");
        } else {
            uint256 tokenId = _tokenIdForSide(offer.marketId, _flipBuyToSell(offer.side));
            outcomeToken.safeTransferFrom(taker, offer.maker, tokenId, fillAmount, "");
            bool ok = collateralToken.transfer(taker, totalCollateral);
            if (!ok) revert Exchange__TransferFailed();
        }

        emit OfferFilled(offerId, offer.maker, taker, fillAmount, offer.price, totalCollateral);
    }

    function setPostingPaused(bool paused) external onlyOwner {
        postingPaused = paused;
        emit PostingPausedSet(paused);
    }

    function setFillingPaused(bool paused) external onlyOwner {
        fillingPaused = paused;
        emit FillingPausedSet(paused);
    }

    function quoteFill(uint256 offerId, uint256 fillAmount) external view returns (uint256 totalCollateral) {
        Offer memory offer = offers[offerId];
        if (offer.maker == address(0)) revert Exchange__InvalidOffer();
        if (offer.status != OfferStatus.Active) revert Exchange__InactiveOffer();
        if (fillAmount == 0 || fillAmount > offer.remainingAmount) revert Exchange__InvalidAmount();
        totalCollateral = _getTotalPrice(fillAmount, offer.price);
        if (totalCollateral == 0) revert Exchange__QuoteTooSmall();
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        if (offer.maker == address(0)) revert Exchange__InvalidOffer();
        if (offer.status != OfferStatus.Active) revert Exchange__InactiveOffer();
        if (_msgSender() != offer.maker) revert Exchange__NotMaker();

        uint256 remaining = offer.remainingAmount;
        offer.remainingAmount = 0;
        offer.status = OfferStatus.Cancelled;

        if (_isSell(offer.side)) {
            uint256 tokenId = _tokenIdForSide(offer.marketId, offer.side);
            outcomeToken.safeTransferFrom(address(this), offer.maker, tokenId, remaining, "");
        } else {
            bool ok = collateralToken.transfer(offer.maker, _getTotalPrice(remaining, offer.price));
            if (!ok) revert Exchange__TransferFailed();
        }

        emit OfferCancelled(offerId, offer.maker);
    }

    function _tokenIdForSide(uint256 marketId, Side side) internal view returns (uint256) {
        if (side == Side.BUY_YES || side == Side.SELL_YES) {
            return outcomeTokenWithHelpers.getYesTokenId(marketId);
        }
        return outcomeTokenWithHelpers.getNoTokenId(marketId);
    }

    function _flipBuyToSell(Side side) internal pure returns (Side) {
        if (side == Side.BUY_YES) return Side.SELL_YES;
        return Side.SELL_NO;
    }

    function _isSell(Side side) internal pure returns (bool) {
        return side == Side.SELL_YES || side == Side.SELL_NO;
    }

    function _getTotalPrice(uint256 amount, uint256 bpsPrice) internal pure returns (uint256) {
        return (amount * bpsPrice) / BPS_DENOMINATOR;
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

