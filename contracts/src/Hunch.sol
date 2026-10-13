// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title Hunch — private parimutuel prediction markets for friend groups.
/// @notice Group names and market questions are stored only as ciphertext (AES-GCM under a group key
///         that never touches the chain in plaintext). Membership is proven with a signature from an
///         invite key derived from the group key, so only people holding the invite link can join.
///         Each member's keyring (group keys wrapped under their passkey-PRF-derived key) lives here too,
///         so a fresh device can rebuild everything from the passkey alone.
contract Hunch {
    enum Outcome { Open, Yes, No, Void }

    struct Group {
        address creator;
        address inviteSigner;
        uint32 memberCount;
        uint64 createdAt;
    }

    struct Market {
        bytes32 groupId;
        address creator;
        uint64 closesAt;
        Outcome outcome;
        uint256 yesPool;
        uint256 noPool;
    }

    IERC20 public immutable usd;

    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(address => bool)) public isMember;
    mapping(address => bytes) public keyring;

    Market[] public markets;
    mapping(uint256 => mapping(address => uint256)) public yesStake;
    mapping(uint256 => mapping(address => uint256)) public noStake;
    mapping(uint256 => mapping(address => bool)) public claimed;
    /// @notice Optional automated settler (e.g. a Chainlink CRE oracle). When set, only it can settle.
    mapping(uint256 => address) public resolverOf;

    event GroupCreated(bytes32 indexed groupId, address indexed creator, bytes encName);
    event MemberJoined(bytes32 indexed groupId, address indexed member);
    event KeyringUpdated(address indexed owner);
    event GroupNote(bytes32 indexed groupId, address indexed author, bytes encNote);
    event MarketCreated(uint256 indexed marketId, bytes32 indexed groupId, address indexed creator, uint64 closesAt, bytes encQuestion);
    event BetPlaced(uint256 indexed marketId, bytes32 indexed groupId, address indexed bettor, bool yes, uint256 amount);
    event MarketResolved(uint256 indexed marketId, bytes32 indexed groupId, Outcome outcome);
    event Claimed(uint256 indexed marketId, bytes32 indexed groupId, address indexed bettor, uint256 payout);

    constructor(IERC20 _usd) {
        usd = _usd;
    }

    // ---------- keyring ----------

    function setKeyring(bytes calldata blob) external {
        keyring[msg.sender] = blob;
        emit KeyringUpdated(msg.sender);
    }

    // ---------- groups ----------

    function createGroup(bytes32 groupId, address inviteSigner, bytes calldata encName) external {
        require(groups[groupId].creator == address(0), "exists");
        require(inviteSigner != address(0), "signer");
        groups[groupId] = Group(msg.sender, inviteSigner, 1, uint64(block.timestamp));
        isMember[groupId][msg.sender] = true;
        emit GroupCreated(groupId, msg.sender, encName);
        emit MemberJoined(groupId, msg.sender);
    }

    /// @param sig invite-key signature over keccak256(groupId, member) (EIP-191 personal_sign).
    function joinGroup(bytes32 groupId, bytes calldata sig) external {
        Group storage g = groups[groupId];
        require(g.creator != address(0), "no group");
        require(!isMember[groupId][msg.sender], "member");
        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(groupId, msg.sender)))
        );
        require(_recover(digest, sig) == g.inviteSigner, "bad invite");
        isMember[groupId][msg.sender] = true;
        g.memberCount++;
        emit MemberJoined(groupId, msg.sender);
    }

    /// @notice Encrypted member-to-group message (display names, comments). Members only.
    function post(bytes32 groupId, bytes calldata encNote) external {
        require(isMember[groupId][msg.sender], "not member");
        emit GroupNote(groupId, msg.sender, encNote);
    }

    // ---------- markets ----------

    function createMarket(bytes32 groupId, uint64 closesAt, bytes calldata encQuestion) external returns (uint256 id) {
        return _createMarket(groupId, closesAt, encQuestion, address(0));
    }

    function createMarketWithResolver(bytes32 groupId, uint64 closesAt, bytes calldata encQuestion, address resolver)
        external
        returns (uint256 id)
    {
        require(resolver != address(0), "resolver");
        return _createMarket(groupId, closesAt, encQuestion, resolver);
    }

    function _createMarket(bytes32 groupId, uint64 closesAt, bytes calldata encQuestion, address resolver)
        internal
        returns (uint256 id)
    {
        require(isMember[groupId][msg.sender], "not member");
        require(closesAt > block.timestamp, "close");
        id = markets.length;
        markets.push(Market(groupId, msg.sender, closesAt, Outcome.Open, 0, 0));
        if (resolver != address(0)) resolverOf[id] = resolver;
        emit MarketCreated(id, groupId, msg.sender, closesAt, encQuestion);
    }

    function bet(uint256 id, bool yes, uint256 amount) external {
        Market storage m = markets[id];
        require(isMember[m.groupId][msg.sender], "not member");
        require(m.outcome == Outcome.Open && block.timestamp < m.closesAt, "closed");
        require(amount > 0, "amount");
        require(usd.transferFrom(msg.sender, address(this), amount), "transfer");
        if (yes) {
            m.yesPool += amount;
            yesStake[id][msg.sender] += amount;
        } else {
            m.noPool += amount;
            noStake[id][msg.sender] += amount;
        }
        emit BetPlaced(id, m.groupId, msg.sender, yes, amount);
    }

    /// @notice Settles a market. Creator-settled markets may settle early (ending betting); markets with an
    ///         automated resolver can only be settled by it, and only after betting closes.
    function resolve(uint256 id, Outcome outcome) external {
        Market storage m = markets[id];
        address r = resolverOf[id];
        if (r == address(0)) {
            require(msg.sender == m.creator, "creator");
        } else {
            require(msg.sender == r, "resolver");
            require(block.timestamp >= m.closesAt, "not closed");
        }
        require(m.outcome == Outcome.Open, "resolved");
        require(outcome != Outcome.Open, "outcome");
        if (block.timestamp < m.closesAt) m.closesAt = uint64(block.timestamp);
        // A one-sided market can't pay anyone from the other side: refund instead.
        if ((outcome == Outcome.Yes && m.yesPool == 0) || (outcome == Outcome.No && m.noPool == 0)) {
            outcome = Outcome.Void;
        }
        m.outcome = outcome;
        emit MarketResolved(id, m.groupId, outcome);
    }

    function payoutOf(uint256 id, address who) public view returns (uint256) {
        Market storage m = markets[id];
        if (m.outcome == Outcome.Open || claimed[id][who]) return 0;
        uint256 y = yesStake[id][who];
        uint256 n = noStake[id][who];
        if (m.outcome == Outcome.Void) return y + n;
        uint256 total = m.yesPool + m.noPool;
        if (m.outcome == Outcome.Yes) return y == 0 ? 0 : (y * total) / m.yesPool;
        return n == 0 ? 0 : (n * total) / m.noPool;
    }

    function claim(uint256 id) external {
        uint256 p = payoutOf(id, msg.sender);
        require(p > 0, "nothing");
        claimed[id][msg.sender] = true;
        require(usd.transfer(msg.sender, p), "transfer");
        emit Claimed(id, markets[id].groupId, msg.sender, p);
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    // ---------- utils ----------

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "sig len");
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
