/**
 * Nimiq Cashlink Integration Tests
 * Tests core functionality of the cashlink generator using testnet.
 *
 * Features:
 * - Tests node connectivity
 * - Verifies consensus establishment
 * - Checks block height
 * - Tests balance queries
 * - Verifies transaction receipt retrieval
 *
 * These tests ensure proper integration with the Nimiq network.
 */

import { getConfig } from '../src/config.ts';
import { RpcClient } from '../src/rpc-client.ts';

// This uses Testnet
async function main() {
    const config = getConfig();
    const client = new RpcClient(config.nodeIp, config.nodePort);

    /**
     * Test 1: Node Connection
     * Verifies that we can connect to the Nimiq node
     */
    const isConnected = await client.isConnected();
    if (!isConnected) {
        throw new Error('Failed to connect to Nimiq node');
    }
    console.log('Connected to node successfully');

    /**
     * Test 2: Consensus Status
     * Checks if the node has established consensus with the network
     */
    const consensusEstablished = await client.isConsensusEstablished();
    if (!consensusEstablished) {
        throw new Error('Node consensus not established');
    }
    console.log('Consensus established');

    /**
     * Test 3: Block Height
     * Retrieves current block height to verify chain access
     */
    const blockHeight = await client.getBlockHeight();
    console.log('Current block height:', blockHeight);

    /**
     * Test 4: Balance Query
     * Tests balance retrieval for a specific address
     */
    const address = 'NQ05 U1RF QJNH JCS1 RDQX 4M3Y 60KR K6CN 5LKC';
    const balance = await client.getBalance(address);
    console.log(`Balance for ${address}:`, balance);

    /**
     * Test 5: Transactions by Address
     * Tests transaction retrieval for a specific address
     */
    const transactions = await client.getTransactionsByAddress(address);
    console.log(`Received ${transactions.length} transactions.`);

    console.log('All tasks completed successfully');
    process.exit(0);
}

await main();
