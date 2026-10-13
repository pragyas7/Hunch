// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHunch {
    function markets(uint256)
        external
        view
        returns (bytes32 groupId, address creator, uint64 closesAt, uint8 outcome, uint256 yesPool, uint256 noPool);
    function resolverOf(uint256) external view returns (address);
    function resolve(uint256 id, uint8 outcome) external;
}

/// @title HunchOracle — Chainlink CRE consumer that settles public-fact hunches.
/// @notice A market creator attaches a public rule ("ETH above $4,000 at close"). After betting closes, a CRE
///         workflow fetches the price from external APIs, reaches consensus across nodes, and delivers a signed
///         report through the Chainlink forwarder. This contract checks the rule and settles the market.
///         The question text stays encrypted; only the rule is public.
contract HunchOracle {
    struct Rule {
        string asset; // CoinGecko id, e.g. "ethereum"
        uint256 threshold; // USD with 8 decimals
        bool above; // YES if price > threshold (or < when false)
        bool settled;
    }

    IHunch public immutable hunch;
    address public immutable forwarder;
    mapping(uint256 => Rule) public rules;
    uint256[] public watched;

    event RuleSet(uint256 indexed marketId, string asset, uint256 threshold, bool above);
    event Settled(uint256 indexed marketId, uint256 price, bool yes);

    constructor(IHunch _hunch, address _forwarder) {
        hunch = _hunch;
        forwarder = _forwarder;
    }

    function setRule(uint256 marketId, string calldata asset, uint256 threshold, bool above) external {
        (, address creator,,,,) = hunch.markets(marketId);
        require(msg.sender == creator, "creator");
        require(hunch.resolverOf(marketId) == address(this), "not oracle market");
        require(bytes(rules[marketId].asset).length == 0, "rule set");
        rules[marketId] = Rule(asset, threshold, above, false);
        watched.push(marketId);
        emit RuleSet(marketId, asset, threshold, above);
    }

    /// @notice Markets whose betting has closed and that still need a price. Read by the CRE workflow.
    function due() external view returns (uint256[] memory ids, string[] memory assets) {
        uint256 n;
        for (uint256 i; i < watched.length; i++) if (_due(watched[i])) n++;
        ids = new uint256[](n);
        assets = new string[](n);
        uint256 j;
        for (uint256 i; i < watched.length; i++) {
            uint256 id = watched[i];
            if (_due(id)) {
                ids[j] = id;
                assets[j++] = rules[id].asset;
            }
        }
    }

    function _due(uint256 id) internal view returns (bool) {
        (,, uint64 closesAt, uint8 outcome,,) = hunch.markets(id);
        return !rules[id].settled && outcome == 0 && block.timestamp >= closesAt;
    }

    /// @notice CRE report entrypoint. report = abi.encode(uint256[] marketIds, uint256[] prices) (8 decimals).
    function onReport(bytes calldata, bytes calldata report) external {
        require(msg.sender == forwarder, "forwarder");
        (uint256[] memory ids, uint256[] memory prices) = abi.decode(report, (uint256[], uint256[]));
        require(ids.length == prices.length, "len");
        for (uint256 i; i < ids.length; i++) {
            if (!_due(ids[i])) continue;
            Rule storage r = rules[ids[i]];
            r.settled = true;
            bool yes = r.above ? prices[i] > r.threshold : prices[i] < r.threshold;
            hunch.resolve(ids[i], yes ? 1 : 2);
            emit Settled(ids[i], prices[i], yes);
        }
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x805f2132 /* IReceiver.onReport */ || id == 0x01ffc9a7 /* ERC165 */;
    }
}
