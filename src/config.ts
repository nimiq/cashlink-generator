/**
 * Nimiq Cashlink Configuration Handler
 * Manages environment configuration for the cashlink generator.
 *
 * Features:
 * - Load environment variables
 * - Validate configuration values
 * - Generate cashlink base URLs
 * - Type-safe configuration access
 *
 * The configuration handler ensures proper setup of the cashlink generator.
 */

import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Retrieves an environment variables and ensures it exists
 * @param name - Environment variable name
 * @returns Validated string value
 * @throws If environment variable is not set
 */
function getEnvVar(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is not set`);
    }
    return value;
}

/**
 * Configuration interface for node settings
 */
export interface NodeConfig {
    nodeIp: string;
    nodePort: string;
    network: 'main' | 'test';
    tokenLength: number;
    salt: string;
    cashlinkBaseUrl: string;
}

/**
 * Generates the base URL for cashlinks based on network
 * @param network - Network identifier ('main' or 'test')
 * @returns Complete base URL for cashlinks
 */
export function getCashlinkBaseUrl(network: 'main' | 'test'): string {
    return `https://hub.nimiq${network === 'main' ? '' : '-testnet'}.com/cashlink/`;
}

/**
 * Gets the complete configuration object
 * Loads and validates all required environment variables
 * @returns Complete node configuration object
 * @throws If any required environment variable is missing
 */
export function getConfig(): NodeConfig {
    const network = getEnvVar('NETWORK');
    if (network !== 'main' && network !== 'test') throw new Error(`Invalid network ${network}`);
    const tokenLength = Number.parseFloat(getEnvVar('TOKEN_LENGTH'));
    if (!Number.isInteger(tokenLength)) throw new Error(`Invalid token length ${tokenLength}`);
    return {
        nodeIp: getEnvVar('NODE_IP'),
        nodePort: getEnvVar('NODE_PORT'),
        network,
        tokenLength,
        salt: getEnvVar('SALT'),
        cashlinkBaseUrl: getCashlinkBaseUrl(network),
    };
}
