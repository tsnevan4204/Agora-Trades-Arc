// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract MarketFactory is Ownable {
    error MarketFactory__InvalidCloseTime();
    error MarketFactory__InvalidEvent();
    error MarketFactory__InvalidMarket();
    error MarketFactory__InvalidCollateral();
    error MarketFactory__EmptyTitle();
    error MarketFactory__EmptyQuestion();
    error MarketFactory__EmptyResolutionSpecURI();
    error MarketFactory__EmptyResolutionSpecHash();
    error MarketFactory__EventAlreadyClosed();

    struct EventData {
        string title;
        string category;
        uint256 closeTime;
        bool exists;
    }

    struct MarketData {
        uint256 eventId;
        string question;
        bytes32 resolutionSpecHash;
        string resolutionSpecURI;
        bool exists;
    }

    address public immutable collateralToken;
    uint256 public nextEventId;
    uint256 public nextMarketId;

    mapping(uint256 => EventData) private s_events;
    mapping(uint256 => MarketData) private s_markets;

    event EventCreated(uint256 indexed eventId, string title, uint256 closeTime, string category);
    event MarketCreated(uint256 indexed marketId, uint256 indexed eventId, string question, bytes32 resolutionSpecHash);

    constructor(address initialOwner, address _collateralToken) Ownable(initialOwner) {
        if (_collateralToken == address(0)) revert MarketFactory__InvalidCollateral();
        collateralToken = _collateralToken;
    }

    function createEvent(string calldata title, string calldata category, uint256 closeTime) external onlyOwner returns (uint256) {
        if (bytes(title).length == 0) revert MarketFactory__EmptyTitle();
        if (closeTime <= block.timestamp) revert MarketFactory__InvalidCloseTime();
        uint256 eventId = nextEventId++;
        s_events[eventId] = EventData({ title: title, category: category, closeTime: closeTime, exists: true });
        emit EventCreated(eventId, title, closeTime, category);
        return eventId;
    }

    function createMarket(
        uint256 eventId,
        string calldata question,
        bytes32 resolutionSpecHash,
        string calldata resolutionSpecURI
    )
        external
        onlyOwner
        returns (uint256)
    {
        if (!s_events[eventId].exists) revert MarketFactory__InvalidEvent();
        if (s_events[eventId].closeTime <= block.timestamp) revert MarketFactory__EventAlreadyClosed();
        if (bytes(question).length == 0) revert MarketFactory__EmptyQuestion();
        if (resolutionSpecHash == bytes32(0)) revert MarketFactory__EmptyResolutionSpecHash();
        if (bytes(resolutionSpecURI).length == 0) revert MarketFactory__EmptyResolutionSpecURI();
        uint256 marketId = nextMarketId++;
        s_markets[marketId] = MarketData({
            eventId: eventId,
            question: question,
            resolutionSpecHash: resolutionSpecHash,
            resolutionSpecURI: resolutionSpecURI,
            exists: true
        });
        emit MarketCreated(marketId, eventId, question, resolutionSpecHash);
        return marketId;
    }

    function getEventData(uint256 eventId) external view returns (EventData memory) {
        return s_events[eventId];
    }

    function getMarketData(uint256 marketId) external view returns (MarketData memory) {
        return s_markets[marketId];
    }

    function marketExists(uint256 marketId) external view returns (bool) {
        return s_markets[marketId].exists;
    }

    function getMarketCloseTime(uint256 marketId) external view returns (uint256) {
        MarketData memory market = s_markets[marketId];
        if (!market.exists) revert MarketFactory__InvalidMarket();
        return s_events[market.eventId].closeTime;
    }
}

