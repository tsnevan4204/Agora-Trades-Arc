// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract OutcomeToken1155 is ERC1155, Ownable {
    error OutcomeToken1155__OnlyManager();
    error OutcomeToken1155__ManagerAlreadySet();
    error OutcomeToken1155__ExchangeAlreadySet();
    error OutcomeToken1155__ZeroAddress();

    address public manager;
    address public exchange;

    constructor(string memory baseUri, address initialOwner) ERC1155(baseUri) Ownable(initialOwner) {}

    function setManager(address newManager) external onlyOwner {
        if (newManager == address(0)) revert OutcomeToken1155__ZeroAddress();
        if (manager != address(0)) revert OutcomeToken1155__ManagerAlreadySet();
        manager = newManager;
    }

    function setExchange(address newExchange) external onlyOwner {
        if (newExchange == address(0)) revert OutcomeToken1155__ZeroAddress();
        if (exchange != address(0)) revert OutcomeToken1155__ExchangeAlreadySet();
        exchange = newExchange;
    }

    function mint(address to, uint256 id, uint256 amount) external {
        if (msg.sender != manager) revert OutcomeToken1155__OnlyManager();
        _mint(to, id, amount, "");
    }

    function burn(address from, uint256 id, uint256 amount) external {
        if (msg.sender != manager) revert OutcomeToken1155__OnlyManager();
        _burn(from, id, amount);
    }

    function isApprovedForAll(address account, address operator) public view override returns (bool) {
        if (operator == exchange && exchange != address(0)) {
            return true;
        }
        return super.isApprovedForAll(account, operator);
    }

    function getYesTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2;
    }

    function getNoTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2 + 1;
    }

    function getMarketId(uint256 tokenId) public pure returns (uint256) {
        return tokenId / 2;
    }

    function isYes(uint256 tokenId) public pure returns (bool) {
        return tokenId % 2 == 0;
    }
}

