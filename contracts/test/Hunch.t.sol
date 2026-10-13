// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Hunch, IERC20} from "../src/Hunch.sol";
import {HunchUSD} from "../src/HunchUSD.sol";
import {HunchOracle, IHunch} from "../src/HunchOracle.sol";

contract HunchTest is Test {
    Hunch hunch;
    HunchUSD usd;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    uint256 invitePk = 0xA11CE;
    bytes32 gid = keccak256("group");

    function setUp() public {
        usd = new HunchUSD();
        hunch = new Hunch(IERC20(address(usd)));
        address[3] memory people = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            usd.claimFor(people[i]);
            vm.prank(people[i]);
            usd.approve(address(hunch), type(uint256).max);
        }
        vm.prank(alice);
        hunch.createGroup(gid, vm.addr(invitePk), hex"01");
        _join(bob);
        _join(carol);
    }

    function _join(address who) internal {
        bytes32 h = keccak256(abi.encodePacked(gid, who));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(invitePk, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h)));
        vm.prank(who);
        hunch.joinGroup(gid, abi.encodePacked(r, s, v));
    }

    function test_joinRequiresInvite() public {
        address eve = makeAddr("eve");
        bytes32 h = keccak256(abi.encodePacked(gid, eve));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(0xBAD, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h)));
        vm.prank(eve);
        vm.expectRevert("bad invite");
        hunch.joinGroup(gid, abi.encodePacked(r, s, v));
    }

    function test_parimutuelPayout() public {
        vm.prank(alice);
        uint256 id = hunch.createMarket(gid, uint64(block.timestamp + 1 days), hex"02");
        vm.prank(alice);
        hunch.bet(id, true, 10e6);
        vm.prank(bob);
        hunch.bet(id, false, 20e6);
        vm.prank(carol);
        hunch.bet(id, true, 30e6);

        vm.prank(alice);
        hunch.resolve(id, Hunch.Outcome.Yes);

        assertEq(hunch.payoutOf(id, alice), 15e6); // 10/40 * 60
        assertEq(hunch.payoutOf(id, carol), 45e6); // 30/40 * 60
        assertEq(hunch.payoutOf(id, bob), 0);

        vm.prank(carol);
        hunch.claim(id);
        assertEq(usd.balanceOf(carol), 50e6 - 30e6 + 45e6);
        vm.prank(carol);
        vm.expectRevert("nothing");
        hunch.claim(id);
    }

    function test_oneSidedVoids() public {
        vm.prank(alice);
        uint256 id = hunch.createMarket(gid, uint64(block.timestamp + 1 days), hex"02");
        vm.prank(bob);
        hunch.bet(id, false, 5e6);
        vm.prank(alice);
        hunch.resolve(id, Hunch.Outcome.Yes);
        assertEq(hunch.payoutOf(id, bob), 5e6);
    }

    function test_nonMemberCannotBet() public {
        vm.prank(alice);
        uint256 id = hunch.createMarket(gid, uint64(block.timestamp + 1 days), hex"02");
        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert("not member");
        hunch.bet(id, true, 1);
    }
}

contract HunchOracleTest is Test {
    Hunch hunch;
    HunchUSD usd;
    HunchOracle oracle;
    address alice = makeAddr("alice");
    address fwd = makeAddr("forwarder");
    uint256 invitePk = 0xA11CE;
    bytes32 gid = keccak256("g");

    function setUp() public {
        usd = new HunchUSD();
        hunch = new Hunch(IERC20(address(usd)));
        oracle = new HunchOracle(IHunch(address(hunch)), fwd);
        usd.claimFor(alice);
        vm.startPrank(alice);
        usd.approve(address(hunch), type(uint256).max);
        hunch.createGroup(gid, vm.addr(invitePk), hex"01");
        vm.stopPrank();
    }

    function test_oracleSettles() public {
        vm.startPrank(alice);
        uint256 id = hunch.createMarketWithResolver(gid, uint64(block.timestamp + 100), hex"02", address(oracle));
        oracle.setRule(id, "ethereum", 4000e8, true);
        hunch.bet(id, true, 1e6);
        vm.expectRevert("resolver");
        hunch.resolve(id, Hunch.Outcome.No); // creator can't settle oracle markets
        vm.stopPrank();

        (uint256[] memory due,) = oracle.due();
        assertEq(due.length, 0);
        vm.warp(block.timestamp + 101);
        (due,) = oracle.due();
        assertEq(due.length, 1);

        uint256[] memory prices = new uint256[](1);
        prices[0] = 4100e8;
        vm.expectRevert("forwarder");
        oracle.onReport("", abi.encode(due, prices));
        vm.prank(fwd);
        oracle.onReport("", abi.encode(due, prices));
        (,,, Hunch.Outcome o,,) = hunch.markets(id);
        assertEq(uint8(o), 1);
    }
}
