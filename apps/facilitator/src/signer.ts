import { createWalletClient, http, publicActions, recoverTypedDataAddress, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import type { Erc20ApprovalGasSponsoringSigner, TransactionRequest } from "@x402/extensions";
import { chainForNetwork, type RobinhoodNetwork } from "@loxley/chain";

export type NetworkSigner = {
  network: RobinhoodNetwork;
  chain: Chain;
  address: `0x${string}`;
  client: ReturnType<typeof createClient>;
  evm: FacilitatorEvmSigner;
  erc20Approval: Erc20ApprovalGasSponsoringSigner;
};

function createClient(privateKey: Hex, chain: Chain, rpcUrl: string) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain,
    transport: http(rpcUrl, { batch: true, retryCount: 3 }),
  }).extend(publicActions);
}

/** One viem client per network, wrapped into the signer shapes @x402/evm and the ERC-20 approval extension expect. */
export function buildSigner(privateKey: Hex, network: RobinhoodNetwork, rpcUrl: string): NetworkSigner {
  const chain = chainForNetwork(network);
  const client = createClient(privateKey, chain, rpcUrl);
  const address = client.account.address;

  const evm = toFacilitatorEvmSigner({
    address,
    getCode: (args) => client.getCode(args),
    readContract: (args) => client.readContract({ ...args, args: args.args ?? [] } as never),
    // EOAs verify locally with one ecrecover; only a mismatch falls through to the on-chain
    // ERC-1271 / ERC-6492 path, which needs an eth_call and only matters for smart accounts.
    verifyTypedData: async (args) => {
      try {
        const recovered = await recoverTypedDataAddress(args as never);
        if (recovered.toLowerCase() === args.address.toLowerCase()) return true;
      } catch {
        // malformed signature for ECDSA; a contract account may still validate it
      }
      const code = await client.getCode({ address: args.address });
      if (!code || code === "0x") return false;
      return client.verifyTypedData(args as never);
    },
    writeContract: (args) => client.writeContract({ ...args, args: args.args ?? [] } as never),
    sendTransaction: (args) => client.sendTransaction(args),
    waitForTransactionReceipt: (args) => client.waitForTransactionReceipt(args),
  });

  const erc20Approval: Erc20ApprovalGasSponsoringSigner = {
    ...evm,
    async sendTransactions(transactions: TransactionRequest[]) {
      const hashes: `0x${string}`[] = [];
      for (const tx of transactions) {
        const hash =
          typeof tx === "string"
            ? await client.sendRawTransaction({ serializedTransaction: tx })
            : await client.sendTransaction({ to: tx.to, data: tx.data, gas: tx.gas });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`transaction_failed: ${hash}`);
        hashes.push(hash);
      }
      return hashes;
    },
  };

  return { network, chain, address, client, evm, erc20Approval };
}
