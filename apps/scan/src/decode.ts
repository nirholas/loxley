import { decodeFunctionData, getAddress, parseAbi, type Hex, type Log } from "viem";
import { X402_EXACT_PERMIT2_PROXY, X402_UPTO_PERMIT2_PROXY } from "@loxley/chain";

export const PROXIES: Record<string, "exact" | "upto"> = {
  [X402_EXACT_PERMIT2_PROXY.toLowerCase()]: "exact",
  [X402_UPTO_PERMIT2_PROXY.toLowerCase()]: "upto",
};

/** Settled() and SettledWithPermit() from x402BasePermit2Proxy. */
export const SETTLED_TOPIC = "0x97088ec3606cfe8cc112180570d03fcde05f9b8e1bfef8e27784eaf5dd5691b6" as const;
export const SETTLED_WITH_PERMIT_TOPIC = "0xde5b89d10fc800c459329c382fabfcad0be0ed7e5328e01fae04e507b09ef5d8" as const;
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

const proxyAbi = parseAbi([
  "struct TokenPermissions { address token; uint256 amount; }",
  "struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }",
  "struct Witness { address to; uint256 validAfter; }",
  "struct UptoWitness { address to; address facilitator; uint256 validAfter; }",
  "struct EIP2612Permit { uint256 value; uint256 deadline; bytes32 r; bytes32 s; uint8 v; }",
  "function settle(PermitTransferFrom permit, address owner, Witness witness, bytes signature)",
  "function settleWithPermit(EIP2612Permit permit2612, PermitTransferFrom permit, address owner, Witness witness, bytes signature)",
  "function settle(PermitTransferFrom permit, uint256 settlementAmount, address owner, UptoWitness witness, bytes signature)",
  "function settleWithPermit(EIP2612Permit permit2612, PermitTransferFrom permit, uint256 settlementAmount, address owner, UptoWitness witness, bytes signature)",
]);

export type DecodedSettle = {
  scheme: "exact" | "upto";
  withPermit: boolean;
  token: `0x${string}`;
  amount: bigint;
  settlementAmount: bigint;
  payer: `0x${string}`;
  payTo: `0x${string}`;
};

/** Decode a settle()/settleWithPermit() call on either proxy. Returns null for anything else. */
export function decodeSettleCalldata(to: string, input: Hex): DecodedSettle | null {
  const scheme = PROXIES[to.toLowerCase()];
  if (!scheme) return null;
  let decoded: ReturnType<typeof decodeFunctionData<typeof proxyAbi>>;
  try {
    decoded = decodeFunctionData({ abi: proxyAbi, data: input });
  } catch {
    return null;
  }
  const withPermit = decoded.functionName === "settleWithPermit";
  const args = decoded.args as readonly unknown[];
  const offset = withPermit ? 1 : 0;
  const permit = args[offset] as { permitted: { token: `0x${string}`; amount: bigint } };
  if (scheme === "exact") {
    const owner = args[offset + 1] as `0x${string}`;
    const witness = args[offset + 2] as { to: `0x${string}` };
    return {
      scheme,
      withPermit,
      token: getAddress(permit.permitted.token),
      amount: permit.permitted.amount,
      settlementAmount: permit.permitted.amount,
      payer: getAddress(owner),
      payTo: getAddress(witness.to),
    };
  }
  const settlementAmount = args[offset + 1] as bigint;
  const owner = args[offset + 2] as `0x${string}`;
  const witness = args[offset + 3] as { to: `0x${string}` };
  return {
    scheme,
    withPermit,
    token: getAddress(permit.permitted.token),
    amount: permit.permitted.amount,
    settlementAmount,
    payer: getAddress(owner),
    payTo: getAddress(witness.to),
  };
}

/** The ERC-20 Transfer that actually moved value in a settlement receipt, if any. */
export function transferInReceipt(logs: Log[], token: string, from: string, to: string): bigint | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== token.toLowerCase()) continue;
    if (l.topics[0] !== TRANSFER_TOPIC || l.topics.length < 3) continue;
    const f = `0x${l.topics[1]!.slice(26)}`.toLowerCase();
    const t = `0x${l.topics[2]!.slice(26)}`.toLowerCase();
    if (f === from.toLowerCase() && t === to.toLowerCase()) return BigInt(l.data);
  }
  return null;
}
