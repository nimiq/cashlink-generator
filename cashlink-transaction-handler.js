const {
    KeyPair,
    ExtendedTransaction,
    SignatureProof,
    Account,
    Transaction,
    Signature,
} = require('@nimiq/core');
const { CashlinkExtraData } = require('./Cashlink');
const TransactionBroadcaster = require('./TransactionBroadcaster');

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
    const keyPair = KeyPair.derive(privateKey);
    const senderAddress = keyPair.publicKey.toAddress();
    const broadcaster = TransactionBroadcaster.getInstance(rpcClient);

    let sent = 0;
    for (const cashlink of cashlinks.values()) {
        const validityStartHeight = await rpcClient.getBlockHeight();
        const transaction = createExtendedTransaction(senderAddress, cashlink.address, cashlink.value, txFee,
            CashlinkExtraData.FUNDING, validityStartHeight, keyPair);
        await broadcaster.broadcastTransaction(transaction);

        sent++;
        if (sent !== cashlinks.size && sent % Math.ceil(cashlinks.size / 20) === 0) {
            console.log(`${sent} Cashlink funding transactions sent so far.`);
        }
    }
    await broadcaster.awaitPendingBroadcasts();
    console.log(`${sent} Cashlink funding transactions sent.`);
}

async function claimCashlinks(cashlinks, recipient, rpcClient) {
    const broadcaster = TransactionBroadcaster.getInstance(rpcClient);

    let processed = 0;
    let unclaimed = 0;
    for (const cashlink of cashlinks.values()) {
        processed++;
        const blockHeightPromise = rpcClient.getBlockHeight();
        const cashlinkBalance = await rpcClient.getBalance(cashlink.address);
        if (cashlinkBalance) {
            unclaimed++;
            const transaction = createExtendedTransaction(cashlink.address, recipient, cashlinkBalance, /* fee */ 0,
                CashlinkExtraData.CLAIMING, await blockHeightPromise, cashlink.keyPair);
            await broadcaster.broadcastTransaction(transaction);
        }

        if (processed !== cashlinks.size && processed % Math.ceil(cashlinks.size / 10) === 0) {
            console.log(`Processed ${processed} Cashlinks so far. ${unclaimed} were unclaimed and redeemed now.`);
        }
    }
    await broadcaster.awaitPendingBroadcasts();
    console.log(`Processed ${processed} Cashlinks, of which ${unclaimed} were unclaimed and redeemed now.`);
}

module.exports = { fundCashlinks, claimCashlinks };

