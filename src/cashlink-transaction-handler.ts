/**
 * Nimiq Cashlink Transaction Handler
 * Manages the funding and claiming of cashlinks through blockchain transactions.
 *
 * Features:
 * - Fund multiple cashlinks from a single wallet
 * - Claim unclaimed cashlinks to a specified address
 * - Handle transaction signing and submission
 * - Support for transaction metadata
 *
 * The transaction handler ensures proper funding and claiming of cashlinks.
 */

import { KeyPair, PrivateKey, Address } from '@nimiq/core';
import { Cashlink, CashlinkExtraData } from './cashlink';
import { RpcClient } from './rpc-client';

/**
 * Funds multiple cashlinks from a single wallet
 * @param cashlinks - Map of cashlinks to fund
 * @param txFee - Transaction fee in luna
 * @param privateKey - Private key of funding wallet
 * @param rpcClient - RPC client for transaction submission
 */
export async function fundCashlinks(
    cashlinks: Map<string, Cashlink>,
    txFee: number,
    privateKey: PrivateKey,
    rpcClient: RpcClient,
): Promise<void> {
    const keyPair = KeyPair.derive(privateKey);

    let sent = 0;
    for (const cashlink of cashlinks.values()) {
        await rpcClient.sendTransaction({
            sender: keyPair,
            recipient: cashlink.address,
            value: cashlink.value,
            fee: txFee,
            data: CashlinkExtraData.FUNDING,
        });

        sent++;
        if (sent !== cashlinks.size && sent % Math.ceil(cashlinks.size / 20) === 0) {
            console.log(`${sent} Cashlink funding transactions sent so far.`);
        }
    }
    console.log(`${sent} Cashlink funding transactions sent.`);
}

/**
 * Claims unclaimed cashlinks to a specified address
 * @param cashlinks - Map of cashlinks to check and claim
 * @param recipient - Address to receive claimed funds
 * @param rpcClient - RPC client for transaction submission
 */
export async function claimCashlinks(
    cashlinks: Map<string, Cashlink>,
    recipient: Address,
    rpcClient: RpcClient,
): Promise<void> {
    let processed = 0;
    let unclaimed = 0;

    for (const cashlink of cashlinks.values()) {
        processed++;
        const cashlinkAddress = cashlink.address;
        const cashlinkBalance = await rpcClient.getBalance(cashlinkAddress.toUserFriendlyAddress());

        if (cashlinkBalance > 0) {
            unclaimed++;
            await rpcClient.sendTransaction({
                sender: cashlink.keyPair,
                recipient,
                value: cashlinkBalance,
                fee: 0,
                data: CashlinkExtraData.CLAIMING,
            });
        }

        if (processed !== cashlinks.size && processed % Math.ceil(cashlinks.size / 10) === 0) {
            console.log(`Processed ${processed} Cashlinks so far. ${unclaimed} were unclaimed and redeemed now.`);
        }
    }

    console.log(`Processed ${processed} Cashlinks, of which ${unclaimed} were unclaimed and redeemed now.`);
}
