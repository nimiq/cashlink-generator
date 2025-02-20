import { NimiqRPCClient, type Transaction } from '@blouflash/nimiq-rpc';
import { KeyPair, Address, TransactionBuilder, BufferUtils } from '@nimiq/core';

/** Parameters for sending a transaction */
interface BaseTransactionParams {
    wallet: string;
    recipient: string;
    value: number;
    fee: number;
    data?: string;
}

type TransactionParams = BaseTransactionParams;

export interface RawTransactionParams {
    sender: KeyPair;
    recipient: string;
    value: number;
    fee?: number;
    data?: string;
}

/**
 * RPC Client for interacting with the Nimiq node
 * Provides methods for blockchain queries and wallet operations
 */
export class RpcClient {
    private _host: string;
    private _port: string;
    private _client: NimiqRPCClient;

    /**
     * Creates a new RPC client instance
     * @param host - The hostname of the Nimiq node
     * @param port - The port number of the Nimiq node
     */
    constructor(host: string, port: string) {
        this._host = host;
        this._port = port;
        this._client = new NimiqRPCClient({
            httpUrl: `http://${this._host}:${this._port}`,
            wsUrl: `ws://${this._host}:${this._port}/ws`,
        });
    }

    /**
     * Checks if the client is connected to the node
     * @returns Promise resolving to true if connected
     */
    async isConnected(): Promise<boolean> {
        try {
            const { data } = await this._client.blockchain.getBlockNumber();
            return data !== undefined;
        } catch (e) {
            return false;
        }
    }

    /**
     * Checks if consensus is established with the network
     * @returns Promise resolving to consensus status
     */
    async isConsensusEstablished(): Promise<boolean> {
        const { data } = await this._client.consensus.isConsensusEstablished();
        return Boolean(data);
    }

    /**
     * Gets the current block height
     * @returns Promise resolving to block number
     */
    async getBlockHeight(): Promise<number> {
        const { data } = await this._client.blockchain.getBlockNumber();
        return Number(data);
    }

    /**
     * Gets the balance of an address
     * @param address - The address to check
     * @returns Promise resolving to balance in luna
     */
    async getBalance(address: string): Promise<number> {
        const { data } = await this._client.blockchain.getAccountByAddress(address);
        return Number(data.balance);
    }

    /**
     * Gets transaction details by hash
     * @param txHash - The transaction hash
     * @returns Promise resolving to transaction details
     * @throws If transaction not found or hash invalid
     */
    async getTransactionReceipt(txHash: string): Promise<Transaction> {
        if (!txHash || typeof txHash !== 'string') {
            throw new Error('Invalid transaction hash');
        }
        const { data } = await this._client.blockchain.getTransactionByHash(txHash);
        if (!data) {
            throw new Error('Transaction not found');
        }
        return data;
    }

    /**
     * Sends a transaction
     * @param params - Transaction parameters
     * @returns Promise resolving to the transaction hash
     */
    async sendTransaction(params: TransactionParams): Promise<string> {
        try {
            const { data } = await this._client.consensus.sendTransaction({
                ...params,
                relativeValidityStartHeight: 0,
            });
            if (!data) throw new Error('Failed to send transaction');
            return data;
        } catch (error) {
            console.error('RPC Error details:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to send transaction: ${errorMessage}`);
        }
    }

    /**
     * Sends a raw transaction using direct transaction creation and signing
     * @param params - Raw transaction parameters including KeyPair for signing
     * @returns Promise resolving to the transaction hash
     */
    async sendRawTransaction(params: RawTransactionParams): Promise<string> {
        try {
            const blockHeight = await this.getBlockHeight();
            // Create transaction using TransactionBuilder
            const transaction = TransactionBuilder.newBasic(
                params.sender.publicKey.toAddress(),
                Address.fromUserFriendlyAddress(params.recipient),
                BigInt(params.value),
                BigInt(params.fee || 0),
                blockHeight,
                5,
            );

            // Sign the transaction
            transaction.sign(params.sender);

            const { data } = await this._client.call<any>({
                method: 'sendRawTransaction',
                params: [ BufferUtils.toHex(transaction.serialize())],
            });
            return data;
        } catch (error) {
            console.error('Raw transaction error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to send raw transaction: ${errorMessage}`);
        }
    }

    /**
     * Imports a wallet key
     * @param keyData - The key data to import
     * @returns Promise resolving to import result
     */
    async importWalletKey(keyData: string): Promise<string> {
        try {
            const { data } = await this._client.wallet.importRawKey({
                keyData,
                passphrase: '',
            });
            if (!data) throw new Error('Failed to import wallet key');
            return data;
        } catch (error) {
            console.error('Wallet import error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to import wallet key: ${errorMessage}`);
        }
    }

    /**
     * Lists all imported wallet accounts
     * @returns Promise resolving to array of addresses
     */
    async listWalletAccounts(): Promise<string[]> {
        try {
            const { data } = await this._client.wallet.listAccounts();
            if (!data) throw new Error('Failed to list wallet accounts');
            return data;
        } catch (error) {
            console.error('Wallet list accounts error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to list wallet accounts: ${errorMessage}`);
        }
    }

    /**
     * Checks if a wallet account is imported
     * @param address - The address to check
     * @returns Promise resolving to import status
     */
    async isWalletAccountImported(address: string): Promise<boolean> {
        try {
            const { data } = await this._client.wallet.isAccountImported(address);
            if (data === undefined) throw new Error('Failed to check if wallet account is imported');
            return Boolean(data);
        } catch (error) {
            console.error('Wallet account check error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to check wallet account: ${errorMessage}`);
        }
    }

    /**
     * Unlocks a wallet account for signing
     * @param address - The address to unlock
     * @param passphrase - Optional passphrase
     * @param duration - Optional duration in milliseconds
     * @returns Promise resolving to unlock status
     */
    async unlockWalletAccount(address: string, passphrase: string = '', duration?: number): Promise<boolean> {
        try {
            const { data } = await this._client.wallet.unlockAccount(address, { passphrase, duration });
            if (data === undefined) throw new Error('Failed to unlock wallet account');
            return Boolean(data);
        } catch (error) {
            console.error('Wallet unlock error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to unlock wallet account: ${errorMessage}`);
        }
    }

    /**
     * Checks if a wallet account is unlocked
     * @param address - The address to check
     * @returns Promise resolving to unlock status
     */
    async isWalletAccountUnlocked(address: string): Promise<boolean> {
        try {
            const { data } = await this._client.wallet.isAccountUnlocked(address);
            if (data === undefined) throw new Error('Failed to check if wallet account is unlocked');
            return Boolean(data);
        } catch (error) {
            console.error('Wallet unlock check error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to check wallet account unlock status: ${errorMessage}`);
        }
    }

    /**
     * Gets all transactions for an address
     * @param address - The address to get transactions for
     * @returns Promise resolving to array of transactions
     */
    async getTransactionsByAddress(address: string): Promise<Transaction[]> {
        try {
            const params = {
                max: 500,
                justHashes: false,
                startAt: null as unknown as string, // startAt is in fact optional in core-rs-albatross, but not in type
            };

            const { data } = await this._client.blockchain.getTransactionsByAddress(address, params);

            if (!data) throw new Error('Failed to get transactions');
            return data;
        } catch (error) {
            console.error('Get transactions error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get transactions: ${errorMessage}`);
        }
    }
}
