const { BaseConsensus, BaseConsensusAgent, Mempool } = require('@nimiq/core');

class TransactionBroadcaster {
    static _instances = new Map(); // rpc client -> TransactionBroadcaster

    static getInstance(rpcClient) {
        const instance = TransactionBroadcaster._instances.get(rpcClient) || new TransactionBroadcaster(rpcClient);
        TransactionBroadcaster._instances.set(rpcClient, instance);
        return instance;
    }

    async broadcastTransaction(transaction) {
        // send transaction as soon as MAX_PARALLEL_BROADCASTS and mempool slots per sender allow
        await Promise.all([
            this._initializedPromise,
            this._awaitFreeBroadcastSlot(transaction),
            this._awaitFreeMempoolSlot(transaction),
        ]);

        // Send the transaction. No await here on purpose to allow for parallel calls.
        const senderUserFriendlyAddress = transaction.sender.toUserFriendlyAddress();
        const broadcastPromise = new Promise((resolve) => (async function sendTransactionUntilSuccess() {
            try {
                await this._rpcClient.sendTransaction(transaction);
                resolve();
            } catch (e) {
                console.warn(`Failed to broadcast transaction ${transaction.hash().toHex()}. Will retry in 1 minute.`);
                setTimeout(sendTransactionUntilSuccess.bind(this), 60000);
            }
        }.bind(this))()).then(() => {
            // mark the transaction only after successful broadcast as pending to avoid that it not being present in the
            // mempool yet can be interpreted as it having been mined.
            this._addMempoolTransaction(transaction.hash().toHex(), senderUserFriendlyAddress);

            // free our reservation on the mempool wait list as we were now added to the mempool
            const senderMempoolSlotWaitList = this._mempoolSlotWaitListPerSender.get(senderUserFriendlyAddress);
            if (senderMempoolSlotWaitList.length > 1) {
                senderMempoolSlotWaitList.splice(senderMempoolSlotWaitList.indexOf(transaction), 1);
            } else {
                this._mempoolSlotWaitListPerSender.delete(senderUserFriendlyAddress);
            }
            this._broadcastPromises.delete(broadcastPromise);
        });
        this._broadcastPromises.add(broadcastPromise);

        // free our reservation on the broadcast wait list as we now claimed a _broadcastPromise
        this._broadcastSlotWaitList.splice(this._broadcastSlotWaitList.indexOf(transaction), 1);
    }

    async awaitPendingBroadcasts() {
        await Promise.all(this._broadcastPromises);
    }

    async _awaitFreeBroadcastSlot(transaction) {
        await this._initializedPromise;
        // Queue up for a slot, even if there are slots available right away, to reserve it. Note that as there is no
        // guarantee on async execution order, multiple slots might become available at once, therefore do not just
        // check the first wait list position.
        this._broadcastSlotWaitList.push(transaction);
        while (
            this._broadcastSlotWaitList.indexOf(transaction)
            >= TransactionBroadcaster.MAX_PARALLEL_BROADCASTS - this._broadcastPromises.size
        ) {
            await Promise.race(this._broadcastPromises);
        }
    }

    async _awaitFreeMempoolSlot(transaction) {
        await this._initializedPromise;
        const isFree = transaction.feePerByte < Mempool.TRANSACTION_RELAY_FEE_MIN;
        if (transaction.fee !== 0 && isFree) console.warn('Specified fee is too low to qualify as paid transaction. '
            + `Use at least ${transaction.serializedSize * Mempool.TRANSACTION_RELAY_FEE_MIN} luna.`);
        const maxMempoolSlots = isFree
            ? Mempool.FREE_TRANSACTIONS_PER_SENDER_MAX
            : Mempool.TRANSACTIONS_PER_SENDER_MAX;
        const senderUserFriendlyAddress = transaction.sender.toUserFriendlyAddress();
        let senderMempoolSlotWaitList = this._mempoolSlotWaitListPerSender.get(senderUserFriendlyAddress);
        if (!senderMempoolSlotWaitList) {
            senderMempoolSlotWaitList = [];
            this._mempoolSlotWaitListPerSender.set(senderUserFriendlyAddress, senderMempoolSlotWaitList);
        }
        // Queue up for a slot, even if there are slots available right away, to reserve it. Note that we could could
        // sort transactions in the queue such that free transactions get broadcast as soon as a free slot is available
        // and take precedence over paid slots. However, we want to retain the original order. Also, in reality, we're
        // not mixing free and paid transactions in this program. Also note that if multiple transactions get mined,
        // multiple slots become available at once and free and paid slots at different times, therefore do not just
        // check the first wait list position.
        senderMempoolSlotWaitList.push(transaction);
        while (
            senderMempoolSlotWaitList.indexOf(transaction)
            >= maxMempoolSlots - this._getMempoolTransactionCount(senderUserFriendlyAddress)
        ) {
            await this._awaitTransactionMining();
        }
    }

    async _awaitTransactionMining() {
        await this._initializedPromise;
        if (!this._transactionMiningPromise) {
            this._transactionMiningPromise = new Promise((resolve) => {
                const checkForMinedTransactions = async () => {
                    let anyMined = false;
                    const blockHeight = await this._rpcClient.getBlockHeight();
                    if (blockHeight !== this._lastBlockHeight) {
                        this._lastBlockHeight = blockHeight;
                        const mempoolTransactionHashes = new Set(await this._rpcClient.getMempoolTransactions());
                        for (const [txHash, senderUserFriendlyAddress] of this._senderPerMempoolTransaction) {
                            if (mempoolTransactionHashes.has(txHash)) continue; // still in mempool
                            // Deletion during iteration is safe: https://stackoverflow.com/a/35943995
                            this._removeMempoolTransaction(txHash, senderUserFriendlyAddress);
                            anyMined = true;
                        }
                    }
                    if (anyMined) {
                        this._transactionMiningPromise = null;
                        resolve();
                    } else {
                        // Check again after short delay. This is not wasteful, as we're most of the time just checking
                        // for a head change.
                        setTimeout(checkForMinedTransactions, 1000);
                    }
                };
                checkForMinedTransactions();
            });
        }
        return this._transactionMiningPromise;
    }

    _addMempoolTransaction(hashHex, senderUserFriendlyAddress) {
        let senderMempoolTransactions = this._mempoolTransactionsPerSender.get(senderUserFriendlyAddress);
        if (!senderMempoolTransactions) {
            senderMempoolTransactions = new Set();
            this._mempoolTransactionsPerSender.set(senderUserFriendlyAddress, senderMempoolTransactions);
        }
        senderMempoolTransactions.add(hashHex);
        this._senderPerMempoolTransaction.set(hashHex, senderUserFriendlyAddress);
    }

    _removeMempoolTransaction(hashHex, senderUserFriendlyAddress) {
        const senderMempoolTransactions = this._mempoolTransactionsPerSender.get(senderUserFriendlyAddress);
        if (senderMempoolTransactions.size > 1) {
            senderMempoolTransactions.delete(hashHex);
        } else {
            this._mempoolTransactionsPerSender.delete(senderUserFriendlyAddress);
        }
        this._senderPerMempoolTransaction.delete(hashHex);
    }

    _getMempoolTransactionCount(senderUserFriendlyAddress) {
        const senderMempoolTransactions = this._mempoolTransactionsPerSender.get(senderUserFriendlyAddress);
        return senderMempoolTransactions ? senderMempoolTransactions.size : 0;
    }

    /** @private */
    constructor(rpcClient) {
        this._rpcClient = rpcClient;
        this._broadcastSlotWaitList = [];
        this._mempoolSlotWaitListPerSender = new Map(); // userfriendly address -> array<transaction>
        this._mempoolTransactionsPerSender = new Map(); // userfriendly address -> Set<hex hash>
        this._senderPerMempoolTransaction = new Map(); // hex hash -> userfriendly address
        this._transactionMiningPromise = null;
        this._lastBlockHeight = 0;
        this._broadcastPromises = new Set();
        // set initial mempool transactions
        this._initializedPromise = rpcClient.getMempoolTransactions(true).then((transactions) =>
            transactions.forEach(({hash, fromAddress}) => this._addMempoolTransaction(hash, fromAddress)));
        // setInterval(() => console.log(
        //     'Broadcast wait list: ',
        //     this._broadcastSlotWaitList.length,
        //     'Parallel Broadcasts: ',
        //     this._broadcastPromises.size,
        //     'Mempool wait list: ',
        //     (this._mempoolSlotWaitListPerSender.get('NQ70 R13G U03S F1FT 4MY7 L2S3 FDB9 QTA7 6SU8')||{}).length || 0,
        //     'Mempool transactions: ', // only cleared in _awaitTransactionMining if mempool limit of a sender reached
        //     (this._mempoolTransactionsPerSender.get('NQ70 R13G U03S F1FT 4MY7 L2S3 FDB9 QTA7 6SU8') || {}).size || 0,
        // ), 5000);
    }
}
// How many transactions to broadcast in parallel without waiting for a confirmation (not block inclusion). This
// is merely for pushing the transactions to our own node. The node then sends out the transactions in a throttled
// fashion itself, see BaseConsensusAgent in core and constants TRANSACTION_RELAY_INTERVAL, TRANSACTIONS_AT_ONCE,
// TRANSACTIONS_PER_SECOND, FREE_TRANSACTION_RELAY_INTERVAL, FREE_TRANSACTIONS_AT_ONCE, FREE_TRANSACTIONS_PER_SECOND.
// Consensus.sendTransaction resolves the latest after BaseConsensus.TRANSACTION_RELAY_TIMEOUT in which case the
// transaction is kept in the local node and waiting for a later relay. The batch size is chosen such that we meet
// the TRANSACTION_PER_SECOND limit if we hit the TRANSACTION_RELAY_TIMEOUT.
// For free transactions the actual througput will be rather limited by the mempool limit.
TransactionBroadcaster.MAX_PARALLEL_BROADCASTS = BaseConsensus.TRANSACTION_RELAY_TIMEOUT / 1000
    * BaseConsensusAgent.TRANSACTIONS_PER_SECOND;

module.exports = TransactionBroadcaster;
