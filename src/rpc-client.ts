import { NimiqRPCClient, Transaction } from '@blouflash/nimiq-rpc';
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
            wsUrl: `ws://${this._host}:${this._port}/ws`
        });
    }

    /**
     * Checks if the client is connected to the node
     * @returns Promise resolving to true if connected
     */
    async isConnected(): Promise<boolean> {
        try {
            const response = await this._client.blockchain.getBlockNumber();
            return response !== undefined;
        } catch (e) {
            return false;
        }
    }

    /**
     * Checks if consensus is established with the network
     * @returns Promise resolving to consensus status
     */
    async isConsensusEstablished(): Promise<boolean> {
        const response = await this._client.consensus.isConsensusEstablished();
        return Boolean(response.data);
    }

    /**
     * Gets the current block height
     * @returns Promise resolving to block number
     */
    async getBlockHeight(): Promise<number> {
        const response = await this._client.blockchain.getBlockNumber();
        return Number(response.data);
    }

    /**
     * Gets the balance of an address
     * @param address - The address to check
     * @returns Promise resolving to balance in luna
     */
    async getBalance(address: string): Promise<number> {
        const response = await this._client.blockchain.getAccountByAddress(address);
        return Number(response.data.balance);
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
        const response = await this._client.blockchain.getTransactionByHash(txHash);
        if (!response.data) {
            throw new Error('Transaction not found');
        }
        return response.data as Transaction;
    }

    /**
     * Sends a transaction
     * @param params - Transaction parameters
     * @returns Promise resolving to transaction result
     */
    async sendTransaction(params: TransactionParams) {
        
        try {
            const response = await this._client.consensus.sendTransaction({
                ...params,
                relativeValidityStartHeight: 0
            });
            if (!response.data) throw new Error('Failed to send transaction');
            return response.data;
        } catch (error) {
            console.error('RPC Error details:', error);
            throw new Error(`Failed to send transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Sends a raw transaction using direct transaction creation and signing
     * @param params - Raw transaction parameters including KeyPair for signing
     * @returns Promise resolving to transaction result
     */
    async sendRawTransaction(params: RawTransactionParams) {
        try {
            const blockHeight = await this.getBlockHeight();
            // Create transaction using TransactionBuilder
            const transaction = TransactionBuilder.newBasic(
                params.sender.publicKey.toAddress(),
                Address.fromUserFriendlyAddress(params.recipient),
                BigInt(params.value),
                BigInt(params.fee || 0),
                blockHeight,
                5
            );

            // Sign the transaction
            transaction.sign(params.sender);

            const data = await this._client.call<any>({ method: 'sendRawTransaction', params: [ BufferUtils.toHex(transaction.serialize())] });
            return data.data;
        } catch (error) {
            console.error('Raw transaction error:', error);
            throw new Error(`Failed to send raw transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Imports a wallet key
     * @param keyData - The key data to import
     * @returns Promise resolving to import result
     */
    async importWalletKey(keyData: string): Promise<string> {
        try {
            const response = await this._client.wallet.importRawKey({
                keyData,
                passphrase: ''
            });
            if (!response.data) throw new Error('Failed to import wallet key');
            return response.data;
        } catch (error) {
            console.error('Wallet import error:', error);
            throw new Error(`Failed to import wallet key: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Lists all imported wallet accounts
     * @returns Promise resolving to array of addresses
     */
    async listWalletAccounts(): Promise<string[]> {
        try {
            const response = await this._client.wallet.listAccounts();
            if (!response.data) throw new Error('Failed to list wallet accounts');
            return response.data;
        } catch (error) {
            console.error('Wallet list accounts error:', error);
            throw new Error(`Failed to list wallet accounts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Checks if a wallet account is imported
     * @param address - The address to check
     * @returns Promise resolving to import status
     */
    async isWalletAccountImported(address: string): Promise<boolean> {
        try {
            const response = await this._client.wallet.isAccountImported(address);
            if (response.data === undefined) throw new Error('Failed to check if wallet account is imported');
            return Boolean(response.data);
        } catch (error) {
            console.error('Wallet account check error:', error);
            throw new Error(`Failed to check wallet account: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
            const response = await this._client.wallet.unlockAccount(address, { passphrase, duration });
            if (response.data === undefined) throw new Error('Failed to unlock wallet account');
            return Boolean(response.data);
        } catch (error) {
            console.error('Wallet unlock error:', error);
            throw new Error(`Failed to unlock wallet account: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Checks if a wallet account is unlocked
     * @param address - The address to check
     * @returns Promise resolving to unlock status
     */
    async isWalletAccountUnlocked(address: string): Promise<boolean> {
        try {
            const response = await this._client.wallet.isAccountUnlocked(address);
            if (response.data === undefined) throw new Error('Failed to check if wallet account is unlocked');
            return Boolean(response.data);
        } catch (error) {
            console.error('Wallet unlock check error:', error);
            throw new Error(`Failed to check wallet account unlock status: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                startAt: null,
            };

            const response = await this._client.blockchain.getTransactionsByAddress(
                address,
                //@ts-ignore
                params
            );
            
            if (!response.data) throw new Error('Failed to get transactions');
            return response.data;
        } catch (error) {
            console.error('Get transactions error:', error);
            throw new Error(`Failed to get transactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
