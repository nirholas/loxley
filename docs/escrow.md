# LoxleyEscrow

Per-request USDG escrow for x402 with an attested release. Source: [contracts/src/LoxleyEscrow.sol](../contracts/src/LoxleyEscrow.sol). Deterministic address on 4663 and 46630: `0xbE7523F2dd81cF23256342423A3CD898AA4E21E7` (salt `keccak256("loxley.escrow.v1")`, fee 0, via the CREATE2 deployer).

## Why

Plain x402 `exact` settles before the buyer sees the response. For a $0.01 call that is fine. For a $5 inference job or a $50 data pull it is not: a 5xx or a response that fails the declared schema is simply lost money. LoxleyEscrow keeps the same one-signature, gasless-for-the-payer flow and adds a verdict.

## Roles

- **payer**: signs one Permit2 witness transfer. Never sends a transaction.
- **payee**: the resource server. Receives funds on an accepted receipt.
- **attestor**: whoever the payer named in the signature, normally the facilitator that fronted the call. Signs a `Receipt` after inspecting the response. Can be an EOA or an ERC-1271 contract.
- **anyone**: submits `open`, `release`, `refund`, `reclaim`. Gas is paid by the submitter, which is how the payer stays gasless.

## Lifecycle

```
open(permit, payer, witness, sig)        Permit2 pulls exact amount into the escrow          status = Open
release(receipt{accepted:true}, sig)     attestor said the response was acceptable            -> payee (minus fee)
refund(receipt{accepted:false}, sig)     attestor said it was not                              -> payer
reclaim(requestId)                       deadline passed with no receipt; anyone may call      -> payer
```

A request id can be opened once. A receipt can be used once. `release` and `refund` are allowed after the deadline as long as nobody has reclaimed yet; `reclaim` is allowed only after it.

## Signed types

Permit2 witness (signed by the payer, Permit2 domain, `spender = LoxleyEscrow`):

```
EscrowWitness(bytes32 requestId,address payee,address attestor,uint64 deadline,bytes32 schemaHash)
witnessTypeString =
  "EscrowWitness witness)EscrowWitness(bytes32 requestId,address payee,address attestor,uint64 deadline,bytes32 schemaHash)TokenPermissions(address token,uint256 amount)"
```

Receipt (signed by the attestor, `LoxleyEscrow` EIP-712 domain, name `LoxleyEscrow` version `1`):

```
Receipt(bytes32 requestId,bytes32 responseHash,uint16 status,bool accepted)
```

`schemaHash` is whatever the parties agreed identifies the acceptable response shape (a hash of a JSON Schema, an OpenAPI operation id, a content type). The contract stores it and emits it so an attestor's judgement is auditable against what the payer asked for; the contract itself does not interpret it.

## Fee

`feeBps` and `feeRecipient` are immutables set at deployment, capped at 500 bps, taken from the payee's side on `release` only. The canonical deployment uses 0.

## Threat model

| Threat | Outcome |
|---|---|
| Facilitator changes the payee or amount | `open` reverts: the witness is inside the Permit2 signature and re-hashed on-chain |
| Facilitator replays a receipt | second call reverts `NotOpen` |
| Attestor signs `accepted: true` and someone calls `refund` with it | reverts `ReceiptVerdictMismatch` |
| Forged receipt | reverts `BadReceipt` (ECDSA or ERC-1271 check against the stored attestor) |
| Attestor disappears | payer reclaims after `deadline` |
| Attestor colludes with payee | the payer chose the attestor; pick one whose receipts are public (Loxley Scan will index them) |
| Reentrancy via token hooks | `nonReentrant` on every state-changing entry point; USDG has no hooks anyway |
| Fee-on-transfer token | not supported by design; USDG is not one |

## Tests

`forge test` runs 12 escrow tests including a fuzz over amount and fee, against the real Permit2 runtime bytecode etched at its canonical address. `forge test --match-contract Fork` with `RHC_MAINNET_RPC_URL` set runs open and release against live Permit2 and live USDG on a fork of 4663.
