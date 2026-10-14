# Hunch contracts

- `src/Hunch.sol`: groups (invite-signature membership), encrypted keyrings, encrypted notes, parimutuel AUSD markets, optional automated resolver per market.
- `src/HunchOracle.sol`: Chainlink CRE consumer. Stores public price rules and settles due markets from forwarder-delivered reports.
- `src/HunchUSD.sol`: mock 6-decimal dollar used in tests (production stakes use Agora testnet AUSD).

```bash
forge install foundry-rs/forge-std --no-git
forge test
```
