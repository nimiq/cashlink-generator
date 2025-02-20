/**
 * Nimiq Cashlink Generator Tool
 * Main entry point for creating, managing, and handling Nimiq cashlinks.
 *
 * Features:
 * - Create new cashlinks with customizable values, messages, and themes
 * - Import and modify existing cashlinks
 * - Fund cashlinks from a wallet
 * - Claim unclaimed cashlinks
 * - Generate QR codes and coin images
 * - Create usage statistics
 */

import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { Writable } from 'stream';
import { BufferUtils, SerialBuffer, Hash, PrivateKey, KeyPair, PublicKey, Address, MnemonicUtils } from '@nimiq/core';
import crypto from 'crypto';
import { getConfig } from './config';
import { RpcClient } from './rpc-client';
import { Cashlink, CashlinkTheme } from './cashlink';
import { exportCashlinks, importCashlinks } from './file-handler';
import renderQrCodes from './render-qr-codes';
import renderCoins from './render-coins';
import { claimCashlinks, fundCashlinks } from './cashlink-transaction-handler';
import { createStatistics } from './cashlink-statistics-handler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Formats date components with leading zeros
 * @param value - Numeric date component
 * @returns Formatted string with leading zero if needed
 */
function padDateComponent(value: number): string {
    return ('0' + value).slice(-2);
}

/**
 * Generates a formatted date string for file naming
 * @returns Date string in YYYY-MM-DD_HHMM format
 */
function getCurrentDateString(): string {
    const date = new Date();
    return date.getFullYear() + '-'
        + padDateComponent(date.getMonth() + 1) + '-'
        + padDateComponent(date.getDate()) + '_'
        + padDateComponent(date.getHours())
        + padDateComponent(date.getMinutes());
}

/**
 * Creates output folder for generated files
 * @returns Path to created folder
 */
function createFolder(): string {
    const folder = `${__dirname}/../generated-cashlinks/${getCurrentDateString()}`;
    if (!fs.existsSync(folder)){
        fs.mkdirSync(folder, { recursive: true });
    }
    return folder;
}

/**
 * CLI prompt helper with proper readline interface
 * @param question - Prompt text to display
 * @returns User input as promise
 */
async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    const response = await new Promise<string>((resolve) => rl.question(question, resolve));
    rl.close();
    return response;
}

/**
 * Interactive prompt for cashlink theme selection
 * @param oldCashlinkTheme - Optional current theme for modification
 * @returns Selected theme number
 */
async function promptCashlinkTheme(oldCashlinkTheme?: number): Promise<number> {
    const cashlinkTheme = await prompt(`${oldCashlinkTheme !== undefined ? 'New ' : ''}Cashlink theme `
        + `[UNSPECIFIED/`
        + Object.keys(CashlinkTheme)
            // filter out https://www.typescriptlang.org/docs/handbook/enums.html#reverse-mappings and UNSPECIFIED
            .filter((name) => !/^(UNSPECIFIED|\d+)$/i.test(name))
            .map((name) => name.toLowerCase())
            .join('/')
        + '/0..255' // ability to specify theme as a number for themes that are not defined in HubApi yet
        + (oldCashlinkTheme !== undefined
            ? `; old theme: ${CashlinkTheme[oldCashlinkTheme]?.toLowerCase() || oldCashlinkTheme}` // reverse map or num
            : '')
        + ']: ',
    );
    return parseInt(cashlinkTheme)
        || CashlinkTheme[cashlinkTheme.toUpperCase() as keyof typeof CashlinkTheme]
        || CashlinkTheme.UNSPECIFIED;
}

/**
 * Securely prompts for private key input
 * Hides input from display and processes backup words
 * Request backup words. Supports multiline input (pasting words separated by newlines).
 * @returns Promise resolving to private key bytes
 */
async function promptPrivateKey(): Promise<Uint8Array> {
    const mutableStdout = new (class MutableStdout extends Writable {
        private state: { muted: boolean };

        constructor() {
            const state = { muted: false };
            super({
                write: function(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
                    if (!state.muted) {
                        process.stdout.write(chunk, encoding);
                    }
                    callback();
                },
            });
            this.state = state;
        }

        set muted(shouldMute: boolean) {
            this.state.muted = shouldMute;
        }
    })();

    const rl = readline.createInterface({
        input: process.stdin,
        output: mutableStdout,
        terminal: true,
    });

    return new Promise((resolve) => {
        const backupWords: string[] = [];

        mutableStdout.muted = false;
        rl.setPrompt('Account (backup words): ');
        rl.prompt(true);
        mutableStdout.muted = true;

        rl.on('line', (line) => {
            // split at whitespace and strip numbers for direct copying from Nimiq Keyguard
            backupWords.push(...line.split(/\d*\s+\d*|\d+/g).filter((word) => !!word));
            if (backupWords.length < 24) return;
            console.log(); // print new line
            rl.close();
        });

        mutableStdout.muted = true;
        rl.on('close', () => {
            const extendedPrivateKey = MnemonicUtils.mnemonicToExtendedPrivateKey(backupWords.join(' '));
            const privateKey = extendedPrivateKey.derivePath(`m/44'/242'/0'/0'`).privateKey;
            resolve(privateKey.serialize());
        });
    });
}

interface WizardResult {
    cashlinks: Map<string, Cashlink>;
    shortLinks: Map<string, string> | null;
}

/**
 * Creates cashlinks with specified parameters
 * @param cashlinkCount - Number of cashlinks to create
 * @param cashlinkValue - Value in luna (1 NIM = 100000 luna)
 * @param cashlinkMessage - Message to include in cashlinks
 * @param cashlinkTheme - Theme number for cashlinks
 * @returns Map of token to Cashlink objects
 */
function createCashlinks(
    cashlinkCount: number,
    cashlinkValue: number,
    cashlinkMessage: string,
    cashlinkTheme: number,
): Map<string, Cashlink> {
    const cashlinks = new Map<string, Cashlink>(); // token -> cashlink
    const config = getConfig();
    // secret salt to deterministically calculate cashlinks from random tokens
    const secretSalt = BufferUtils.fromBase64(config.salt);

    while (cashlinks.size < cashlinkCount) {
        const tokenEntropy = config.tokenLength * 6; // in bit. Tokens are base64. Each base64 char encodes 6 bit.
        const randomBytes = crypto.randomBytes(Math.ceil(tokenEntropy / 8));
        const token = BufferUtils.toBase64Url(randomBytes).substring(0, config.tokenLength);
        if (cashlinks.has(token)) continue;

        const tokenBytes = BufferUtils.fromBase64Url(token);
        const saltedTokenBytes = new SerialBuffer(tokenBytes.length + secretSalt.length);
        saltedTokenBytes.write(tokenBytes);
        saltedTokenBytes.write(secretSalt);
        const privateKeyBytes = Hash.computeBlake2b(saltedTokenBytes);
        const privateKey = PrivateKey.deserialize(privateKeyBytes);
        const keyPair = KeyPair.derive(privateKey);

        cashlinks.set(
            token,
            new Cashlink(config.cashlinkBaseUrl, keyPair, cashlinkValue, cashlinkMessage, cashlinkTheme),
        );
    }
    return cashlinks;
}

/**
 * Interactive wizard for cashlink creation
 * Guides user through the process of creating new cashlinks
 * @returns Created cashlinks and optional short links
 */
async function wizardCreateCashlinks(): Promise<WizardResult> {
    const cashlinkCount = parseInt(await prompt('How many Cashlinks do you want to create?: '));
    if (Number.isNaN(cashlinkCount) || cashlinkCount <= 0) {
        throw new Error(`Invalid cashlink count ${cashlinkCount}`);
    }

    const cashlinkValue = Math.round(parseFloat(await prompt('Cashlink value in NIM: ')) * 1e5);
    if (Number.isNaN(cashlinkValue) || cashlinkValue <= 0) {
        throw new Error('Invalid cashlink value');
    }

    const defaultCashlinkMessage = 'Welcome to Nimiq - Crypto for Humans';
    const cashlinkMessage = (await prompt(`Cashlink message ["none"/message, default: "${defaultCashlinkMessage}"]: `)
        || defaultCashlinkMessage).replace(/^none$/, '');

    const cashlinkTheme = await promptCashlinkTheme();

    const defaultShortLinkBaseUrl = 'https://nim.id/';
    const shortLinkBaseUrl = (await prompt(`Short link base url ["none"/URL, default: "${defaultShortLinkBaseUrl}"]: `)
        || defaultShortLinkBaseUrl).replace(/(?<!^none|[=?&#])\/?$/, '/');

    console.log('\nCreating Cashlinks');
    const cashlinks = createCashlinks(cashlinkCount, cashlinkValue, cashlinkMessage, cashlinkTheme);

    const shortLinks = shortLinkBaseUrl !== 'none'
        ? new Map([...cashlinks.keys()].map((token): [string, string] => [token, `${shortLinkBaseUrl}${token}`]))
        : null;

    console.log(`${cashlinks.size} Cashlinks created.\n`);

    return { cashlinks, shortLinks };
}

const Operation = {
    CHANGE_MESSAGE: 'change-message',
    CHANGE_THEME: 'change-theme',
    CREATE_IMAGES: 'create-images',
    FUND: 'fund',
    CLAIM: 'claim',
    STATISTICS: 'statistics',
} as const;

type OperationType = typeof Operation[keyof typeof Operation];

type ImageFiles = Map<string, string>;

/**
 * Interactive wizard for creating image files
 * Guides user through the process of generating QR codes or coin images
 * @param cashlinks - Map of cashlink tokens to Cashlink objects
 * @param shortLinks - Optional map of short links
 * @param folder - Output folder for generated images
 * @returns Map of token to image file paths
 */
async function wizardCreateImages(
    cashlinks: Map<string, Cashlink>,
    shortLinks: Map<string, string> | null,
    folder: string,
): Promise<ImageFiles> {
    const format = await prompt('Choose an output format [QR/coin]: ');
    let imageFiles: ImageFiles;

    if (format.toLowerCase() !== 'coin') {
        console.log('\nRendering QR Codes');
        const links = shortLinks
            || new Map([...cashlinks].map(([token, cashlink]) => [token, cashlink.render()]));
        imageFiles = renderQrCodes(links, folder);
        console.log('QR Codes rendered.\n');
    } else {
        console.log('\nRendering CashCoins');
        imageFiles = renderCoins(cashlinks, shortLinks, folder);
        console.log('CashCoins rendered.\n');
    }

    return imageFiles;
}

/**
 * Interactive wizard for funding cashlinks
 * Guides user through the process of funding cashlinks from a wallet
 * @param cashlinks - Map of cashlink tokens to Cashlink objects
 * @param rpcClient - RPC client for interacting with the Nimiq node
 */
async function wizardFundCashlinks(cashlinks: Map<string, Cashlink>, rpcClient: RpcClient) {
    const totalValue = [...cashlinks.values()].reduce((sum, cashlink) => sum + cashlink.value, 0);
    const fee = 0;

    console.log('\nBefore funding the Cashlinks, please check the generated assets.');
    console.log('To continue with funding, please import an account via its backup words to use for funding and make '
        + `sure it holds at least ${totalValue / 1e5} NIM (with fees ${(totalValue + fee * cashlinks.size) / 1e5} NIM).`
        // The past showed that it's recommendable to create separate keys for each Cashlink campaign for better
        // bookkeeping, for example if unclaimed Cashlinks are to be reclaimed, they can be reclaimed to the funding
        // address that was created just for that campaign and then be sent back to some more generic marketing account
        // from there. Using a regularly used key instead of a separate key is not recommended and can be inconvenient
        // because Cashlink generation and reclaiming leads to a lot of transactions on that address which clutter the
        // transaction history and are extra effort to sync in the Wallet because it matches each Cashlink with its
        // final recipient, so has to end up querying each Cashlink address as well.
        + 'Note that it\'s recommendable to create a new key only for this operation.');

    const privateKeyBytes = await promptPrivateKey();
    const privateKey = PrivateKey.deserialize(new SerialBuffer(privateKeyBytes));
    const address = PublicKey.derive(privateKey).toAddress();
    const userFriendlyAddress = address.toUserFriendlyAddress();
    const balance = await rpcClient.getBalance(userFriendlyAddress);

    console.log(`Using address ${userFriendlyAddress} with balance ${balance / 1e5}`);
    if (balance < totalValue) throw new Error('Not enough balance.');
    if (await prompt('Ok? [y/N]: ') !== 'y') {
        console.log('Not funding Cashlinks.');
        return;
    }

    // Import the wallet key if not already imported
    const isImported = await rpcClient.isWalletAccountImported(userFriendlyAddress);
    if (!isImported) {
        console.log('Importing wallet key...');
        await rpcClient.importWalletKey(BufferUtils.toHex(privateKeyBytes));
    }

    // Unlock the account
    console.log('Unlocking account...');
    const isUnlocked = await rpcClient.unlockWalletAccount(userFriendlyAddress);
    if (!isUnlocked) {
        throw new Error('Failed to unlock account');
    }

    console.log('\nFunding Cashlinks');
    await fundCashlinks(cashlinks, fee, privateKey, rpcClient);
    console.log('Cashlinks funded.');
}

/**
 * Interactive wizard for creating cashlink statistics
 * Guides user through the process of generating usage statistics
 * @param cashlinks - Map of cashlink tokens to Cashlink objects
 * @param folder - Output folder for generated statistics
 * @param rpcClient - RPC client for interacting with the Nimiq node
 */
async function wizardCreateStatistics(
    cashlinks: Map<string, Cashlink>,
    folder: string,
    rpcClient: RpcClient,
): Promise<void> {
    const reclaimUserFriendlyAddress = await prompt('Address cashlinks have been reclaimed to [default: none]: ');
    const reclaimAddress = reclaimUserFriendlyAddress
        ? Address.fromUserFriendlyAddress(reclaimUserFriendlyAddress)
        : null;
    const timeZone = await prompt('Timezone to use for claims-per-day statistic [default: "UTC", '
        + `your timezone: "${Intl.DateTimeFormat().resolvedOptions().timeZone}"]: `) || 'UTC';

    console.log('\nGenerating Cashlink statistics');
    const statistics = await createStatistics(cashlinks, reclaimAddress, timeZone, rpcClient);
    console.log('Cashlink statistics generated.');

    console.log(`\nStatistics:\n${statistics}`);

    const file = `${folder || '.'}/${getCurrentDateString()} statistics.txt`.replace(__dirname, '.');
    if (await prompt(`Do you want to export the statistics to ${file}? [Y/n]: `) === 'n') return;
    fs.writeFileSync(file, statistics);
    console.log(`Statistics exported to ${file}.`);
}

/**
 * Interactive wizard for importing cashlinks
 * Guides user through the process of loading existing cashlinks from a file
 * @returns Imported cashlinks, short links, image files, and folder path
 */
async function wizardImportCashlinks(): Promise<WizardResult & { imageFiles: ImageFiles, folder: string } | null> {
    let importedFile = await prompt('Do you want to create new cashlinks or load existing cashlinks?\n'
        + 'If you want to load cashlinks, specify the path to the exported csv file: ');
    if (!importedFile) return null;

    try {
        // Convert relative path to absolute path
        importedFile = path.resolve(process.cwd(), importedFile);
        console.log(`Resolving file path: ${importedFile}`);

        // Check if file exists and is accessible
        if (!fs.existsSync(importedFile)) {
            throw new Error(`File not found: ${importedFile}`);
        }

        const stats = fs.statSync(importedFile);
        if (!stats.isFile()) {
            throw new Error(`Not a file: ${importedFile}`);
        }

        console.log('\nLoading Cashlinks');
        const folder = path.dirname(importedFile);
        console.log(`Using folder: ${folder}`);

        try {
            const result = importCashlinks(importedFile);
            console.log(`${result.cashlinks.size} Cashlinks loaded.\n`);
            return { ...result, folder };
        } catch (e) {
            throw new Error(`Failed to parse cashlinks file: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
    } catch (error) {
        console.error('\nImport error:', error instanceof Error ? error.message : 'Unknown error');
        if (await prompt('\nWould you like to create new cashlinks instead? [y/N]: ') === 'y') {
            return null;
        }
        throw error;
    }
}

/**
 * Interactive wizard for claiming unclaimed cashlinks
 * Guides user through the process of redeeming unclaimed cashlinks to a specified address
 * @param cashlinks - Map of cashlink tokens to Cashlink objects
 * @param rpcClient - RPC client for interacting with the Nimiq node
 */
async function wizardClaimCashlinks(
    cashlinks: Map<string, Cashlink>,
    rpcClient: RpcClient,
): Promise<void> {
    const recipientUserFriendlyAddress = await prompt('Redeem unclaimed Cashlinks to address: ');
    const recipientAddress = Address.fromUserFriendlyAddress(recipientUserFriendlyAddress);

    if (await prompt(`Redeeming unclaimed Cashlinks to ${recipientUserFriendlyAddress}, ok? [y/N]: `) !== 'y') {
        console.log('Not redeeming Cashlinks.');
        return;
    }

    console.log('\nRedeeming unclaimed Cashlinks');
    await claimCashlinks(cashlinks, recipientAddress, rpcClient);
    console.log('Unclaimed Cashlinks redeemed.');
}

/**
 * Interactive wizard for changing cashlink messages
 * Guides user through the process of modifying the message of existing cashlinks
 * @param cashlinks - Map of cashlink tokens to Cashlink objects
 * @returns Boolean indicating if the message was changed
 */
async function wizardChangeMessage(cashlinks: Map<string, Cashlink>): Promise<boolean> {
    const oldCashlinkMessage = cashlinks.values().next().value?.message || '';
    const newCashlinkMessage = (
        await prompt(`New Cashlink message ["none"/message, old message: "${oldCashlinkMessage}"]: `)
        || oldCashlinkMessage
    ).replace(/^none$/, '');

    if (oldCashlinkMessage === newCashlinkMessage) {
        console.log('Keeping the old Cashlink message.')
        return false;
    }

    console.log('\nChanging Cashlink message');
    for (const cashlink of cashlinks.values()) {
        cashlink.message = newCashlinkMessage;
    }
    console.log('Cashlink message changed.\n');
    return true;
}

/**
 * Interactive wizard for changing cashlink themes
 * Guides user through the process of modifying the theme of existing cashlinks
 * @param cashlinks - Map of cashlink tokens to Cashlink objects
 * @returns Boolean indicating if the theme was changed
 */
async function wizardChangeTheme(cashlinks: Map<string, Cashlink>): Promise<boolean> {
    const oldCashlinkTheme = cashlinks.values().next().value?.theme || CashlinkTheme.UNSPECIFIED;
    const newCashlinkTheme = await promptCashlinkTheme(oldCashlinkTheme);

    if (oldCashlinkTheme === newCashlinkTheme) {
        console.log('Keeping the old Cashlink theme.')
        return false;
    }

    console.log('\nChanging Cashlink theme');
    for (const cashlink of cashlinks.values()) {
        cashlink.theme = newCashlinkTheme;
    }
    console.log('Cashlink theme changed.\n');
    return true;
}

/**
 * Main application entry point
 * Handles the complete workflow of cashlink operations
 * including creation, modification, funding, and claiming
 */
async function main() {
    try {
        const config = getConfig();
        const client = new RpcClient(config.nodeIp, config.nodePort);
        console.log('Welcome to the cashlink generator!\n');

        // Initialize variables
        let cashlinks: Map<string, Cashlink>;
        let shortLinks: Map<string, string> | null;
        let imageFiles: ImageFiles = new Map();
        let folder: string;
        let operations: OperationType[];
        let shouldExport = false;

        // Handle import or create new cashlinks
        const importResult = await wizardImportCashlinks();
        if (importResult) {
            ({ cashlinks, shortLinks, imageFiles, folder } = importResult);
            const operation = await prompt(
                `What do you want to do? [${Object.values(Operation).join('/')}]: `,
            );
            if (!Object.values(Operation).includes(operation as OperationType)) {
                throw new Error(`Unsupported operation ${operation}`);
            }
            operations = [operation as OperationType];
        } else {
            ({ cashlinks, shortLinks } = await wizardCreateCashlinks());
            folder = createFolder();
            operations = [Operation.CREATE_IMAGES, Operation.FUND];
            shouldExport = true;
        }

        // Process operations
        if (operations.includes(Operation.CREATE_IMAGES)) {
            const oldImageFiles = imageFiles;
            imageFiles = await wizardCreateImages(cashlinks, shortLinks, folder);
            shouldExport = shouldExport || !oldImageFiles.size
                || oldImageFiles.values().next().value !== imageFiles.values().next().value;
        }

        if (operations.includes(Operation.CHANGE_MESSAGE)) {
            shouldExport = shouldExport || await wizardChangeMessage(cashlinks);
        }

        if (operations.includes(Operation.CHANGE_THEME)) {
            shouldExport = shouldExport || await wizardChangeTheme(cashlinks);
        }

        if (shouldExport) {
            console.log('Exporting cashlinks.');
            const file = `${folder || '.'}/cashlinks`
                + (importResult ? ` (update ${getCurrentDateString()} ${operations.join(' ')})` : '')
                + '.csv';
            exportCashlinks(cashlinks, shortLinks, imageFiles, file);
            console.log(`Cashlinks exported to ${file.replace(__dirname, '.')}.\n`);
        }

        if (operations.includes(Operation.FUND)) {
            // fund after export, to make sure the cashlinks were saved, if needed
            await wizardFundCashlinks(cashlinks, client);
        }

        if (operations.includes(Operation.STATISTICS)) {
            await wizardCreateStatistics(cashlinks, folder, client);
        }

        if (operations.includes(Operation.CLAIM)) {
            await wizardClaimCashlinks(cashlinks, client);
        }

        console.log('\nAll operations finished :)');
        if (operations.includes(Operation.FUND) || operations.includes(Operation.CLAIM)) {
            console.log(
                'Transactions might still be pending in your local node and waiting to be relayed to other nodes.\n'
                + 'Make sure to check your wallet balance and keep your node running if needed.',
            );
        }
        process.exit(0);
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
    }
}

// Execute and handle unhandled rejections
main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
