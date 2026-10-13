import { createPublicClient, http, parseAbi, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const HUNCH = import.meta.env.VITE_HUNCH as Address;
export const ORACLE = (import.meta.env.VITE_ORACLE || "") as Address | "";
export const USD = import.meta.env.VITE_USD as Address;
export const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_DEPLOY_BLOCK);
export const EXPLORER = "https://testnet.monadexplorer.com";

export const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });

export const hunchAbi = parseAbi([
  "function setKeyring(bytes blob)",
  "function keyring(address) view returns (bytes)",
  "function createGroup(bytes32 groupId, address inviteSigner, bytes encName)",
  "function joinGroup(bytes32 groupId, bytes sig)",
  "function groups(bytes32) view returns (address creator, address inviteSigner, uint32 memberCount, uint64 createdAt)",
  "function isMember(bytes32, address) view returns (bool)",
  "function post(bytes32 groupId, bytes encNote)",
  "event GroupNote(bytes32 indexed groupId, address indexed author, bytes encNote)",
  "function createMarket(bytes32 groupId, uint64 closesAt, bytes encQuestion) returns (uint256)",
  "function createMarketWithResolver(bytes32 groupId, uint64 closesAt, bytes encQuestion, address resolver) returns (uint256)",
  "function resolverOf(uint256) view returns (address)",
  "function marketCount() view returns (uint256)",
  "function bet(uint256 id, bool yes, uint256 amount)",
  "function resolve(uint256 id, uint8 outcome)",
  "function claim(uint256 id)",
  "function payoutOf(uint256 id, address who) view returns (uint256)",
  "function markets(uint256) view returns (bytes32 groupId, address creator, uint64 closesAt, uint8 outcome, uint256 yesPool, uint256 noPool)",
  "function yesStake(uint256, address) view returns (uint256)",
  "function noStake(uint256, address) view returns (uint256)",
  "function claimed(uint256, address) view returns (bool)",
  "event GroupCreated(bytes32 indexed groupId, address indexed creator, bytes encName)",
  "event MemberJoined(bytes32 indexed groupId, address indexed member)",
  "event MarketCreated(uint256 indexed marketId, bytes32 indexed groupId, address indexed creator, uint64 closesAt, bytes encQuestion)",
  "event BetPlaced(uint256 indexed marketId, bytes32 indexed groupId, address indexed bettor, bool yes, uint256 amount)",
  "event MarketResolved(uint256 indexed marketId, bytes32 indexed groupId, uint8 outcome)",
  "event Claimed(uint256 indexed marketId, bytes32 indexed groupId, address indexed bettor, uint256 payout)",
]);

export const oracleAbi = parseAbi([
  "function setRule(uint256 marketId, string asset, uint256 threshold, bool above)",
  "function rules(uint256) view returns (string asset, uint256 threshold, bool above, bool settled)",
  "event Settled(uint256 indexed marketId, uint256 price, bool yes)",
]);

export const usdAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function claimed(address) view returns (bool)",
]);

export const fmtUsd = (v: bigint) =>
  "$" + (Number(v) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
