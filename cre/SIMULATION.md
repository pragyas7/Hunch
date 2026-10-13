# CRE simulation: settled a live Hunch market on Monad testnet

`cre workflow simulate settle-wf --target staging-settings --broadcast` (CRE CLI v1.38.0, 2026-10-13)

```
[SIMULATION] Running trigger trigger=cron-trigger@1.0.0
[USER LOG] 1 hunch(es) due: 4
[USER LOG] ethereum = $2512.67
[USER LOG] settled 1 hunch(es) in tx 0x892c85e12e3d2328a6963b948b5b4ad74c5070b91fb5b834eff61a1fad05775a
✓ Workflow Simulation Result:
"0x892c85e12e3d2328a6963b948b5b4ad74c5070b91fb5b834eff61a1fad05775a"
```

- Market #4: "Will ETH be above $2,510 when betting closes?" (rule: `ethereum > 2510e8`)
- Settlement tx: https://testnet.monadexplorer.com/tx/0x892c85e12e3d2328a6963b948b5b4ad74c5070b91fb5b834eff61a1fad05775a
- Result onchain: `Hunch.markets(4).outcome == 1` (YES). Priya's $6 YES bet collects the $10 pot.
