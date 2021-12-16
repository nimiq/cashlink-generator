const { CashlinkExtraData } = require('./Cashlink');
const {
    Address,
    KeyPair,
    ExtendedTransaction,
    SignatureProof,
    Account,
    Transaction,
    Signature,
    Mempool,
} = require('@nimiq/core');

function createExtendedTransaction(sender, recipient, value, fee, extraData, validityStartHeight, keyPair) {
    const transaction = new ExtendedTransaction(sender, Account.Type.BASIC,
        recipient, Account.Type.BASIC, value, fee, validityStartHeight,
        Transaction.Flag.NONE, extraData);
    transaction.proof = SignatureProof.singleSig(
        keyPair.publicKey,
        Signature.create(keyPair.privateKey, keyPair.publicKey, transaction.serializeContent()),
    ).serialize();
    return transaction;
}

async function fundCashlinks(cashlinks, txFee, privateKey, rpcClient) {
    cashlinks = [ ...cashlinks.values() ];
    const keyPair = KeyPair.derive(privateKey);
    const senderAddress = keyPair.publicKey.toAddress();
    const pendingTransactionHashes = new Set(await rpcClient.getMempoolTransactions());

    // The transactions all have the same size. Test via one example transaction whether the transactions will be
    // considered as free transactions.
    const testTx = createExtendedTransaction(senderAddress, cashlinks[0].address, 1, txFee, CashlinkExtraData.FUNDING,
        0, keyPair);
    // console.log(`Tx size: ${testTx.serializedSize}`);
    const isFree = testTx.feePerByte < Mempool.TRANSACTION_RELAY_FEE_MIN;
    if (txFee !== 0 && isFree) throw new Error('Specified fee is too low to qualify as paid transaction. '
        + `Use at least ${testTx.serializedSize * Mempool.TRANSACTION_RELAY_FEE_MIN} luna.`);
    const simultaneousTransactionLimit = isFree
        ? Mempool.FREE_TRANSACTIONS_PER_SENDER_MAX
        : Mempool.TRANSACTIONS_PER_SENDER_MAX;

    let sent = 0;
    while (sent < cashlinks.length) {
        let mempoolTransactionHashes = new Set(await rpcClient.getMempoolTransactions());
        for (const txHash of pendingTransactionHashes) {
            if (mempoolTransactionHashes.has(txHash)) continue;
            pendingTransactionHashes.delete(txHash); // has been mined
        }

        let cashlinksToSend = Math.max(0,
            Math.min(
                simultaneousTransactionLimit - pendingTransactionHashes.size,
                Mempool.SIZE_MAX - mempoolTransactionHashes.size,
                cashlinks.length - sent,
            )
        );

        if (cashlinksToSend === 0) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            continue;
        }

        const validityStartHeight = await rpcClient.getBlockHeight();

        while (cashlinksToSend > 0) {
            const cashlink = cashlinks[sent];
            const transaction = createExtendedTransaction(senderAddress, cashlink.address, cashlink.value, txFee,
                CashlinkExtraData.FUNDING, validityStartHeight, keyPair);
            pendingTransactionHashes.add(transaction.hash().toHex());
            await rpcClient.sendTransaction(transaction);
            cashlinksToSend--;
            sent++;
        }

        console.log(`${sent} Cashlink funding transactions sent so far.`);
    }
}

async function claimCashlinks(cashlinks, recipient, rpcClient) {
    // Can use a fixed fee of zero and don't have to keep track of free mempool transactions per sender, as each sender
    // Cashlink will only send one claiming transaction.
    cashlinks = cashlinks.values();

    let processed = 0;
    let unclaimed = 0;
    for (const cashlink of cashlinks) {
        processed++;
        const blockHeightPromise = rpcClient.getBlockHeight();
        const cashlinkBalance = await rpcClient.getBalance(cashlink.address);
        if (cashlinkBalance === 0) continue;
        unclaimed++;
        const transaction = createExtendedTransaction(cashlink.address, recipient, cashlinkBalance, /* fee */ 0,
            CashlinkExtraData.CLAIMING, await blockHeightPromise, cashlink.keyPair);
        await rpcClient.sendTransaction(transaction);
        if (processed !== cashlinks.size && processed % Math.ceil(cashlinks.size / 10) === 0) {
            console.log(`Processed ${processed} Cashlinks so far. ${unclaimed} were unclaimed and redeemed now.`);
        }
    }
    console.log(`Processed ${processed} Cashlinks, of which ${unclaimed} were unclaimed and redeemed now.`);
}

module.exports = { fundCashlinks, claimCashlinks };

