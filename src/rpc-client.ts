import { NimiqRPCClient, type Transaction } from '@blouflash/nimiq-rpc';
import { KeyPair, Address, TransactionBuilder } from '@nimiq/core';
import { getConfig } from './config.ts';

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
    recipient: Address;
    value: number;
    fee?: number;
    data?: Uint8Array;
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
            return Number.isInteger(data);
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
        if (typeof data !== 'boolean') throw new Error('Failed to check for consensus');
        return data;
    }

    /**
     * Gets the current block height
     * @returns Promise resolving to block number
     */
    async getBlockHeight(): Promise<number> {
        const { data } = await this._client.blockchain.getBlockNumber();
        if (!Number.isInteger(data)) throw new Error('Failed to fetch block height');
        return Number(data);
    }

    /**
     * Gets the balance of an address
     * @param address - The address to check
     * @returns Promise resolving to balance in luna
     */
    async getBalance(address: string): Promise<number> {
        const { data } = await this._client.blockchain.getAccountByAddress(address);
        if (!data) throw new Error('Failed to fetch balance');
        return Number(data.balance);
    }

    /**
     * Sends a raw transaction using direct transaction creation and signing
     * @param params - Raw transaction parameters including KeyPair for signing
     * @returns Promise resolving to the transaction hash
     */
    async sendTransaction(params: RawTransactionParams): Promise<string> {
        const blockHeight = await this.getBlockHeight();
        const networkId = {
            main: 24,
            test: 5,
        }[getConfig().network];
        // Create transaction using TransactionBuilder
        const transaction = TransactionBuilder.newBasicWithData(
            params.sender.publicKey.toAddress(),
            params.recipient,
            params.data || new Uint8Array(),
            BigInt(params.value),
            BigInt(params.fee || 0),
            blockHeight,
            networkId,
        );

        // Sign the transaction
        transaction.sign(params.sender);

        const { data } = await this._client.consensus.sendRawTransaction({
            rawTransaction: transaction.toHex(),
        });
        if (!data) throw new Error('Failed to send raw transaction');
        return data;
    }

    /**
     * Gets all transactions for an address
     * @param address - The address to get transactions for
     * @returns Promise resolving to array of transactions
     */
    async getTransactionsByAddress(address: string): Promise<Transaction[]> {
        const params = {
            max: 500,
            justHashes: false,
            startAt: null as unknown as string, // startAt is in fact optional in core-rs-albatross, but not in type
        };

        const { data } = await this._client.blockchain.getTransactionsByAddress(address, params);

        if (!data) throw new Error('Failed to get transactions');
        return data;
    }
}
