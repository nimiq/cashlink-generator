const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Writable = require('stream').Writable;
const {
    Address,
    GenesisConfig,
    KeyPair,
    PrivateKey,
    PublicKey,
    BufferUtils,
    SerialBuffer,
    Hash,
    MnemonicUtils,
    Mempool,
} = require('@nimiq/core');
const { CashlinkTheme } = require('@nimiq/hub-api');
const { Cashlink } = require('./Cashlink');
const { importCashlinks, exportCashlinks } = require('./file-handler');
const renderCoins = require('./render-coins');
const renderQrCodes = require('./render-qr-codes');
const RpcClient = require('./RpcClient');
const { fundCashlinks, claimCashlinks } = require('./cashlink-transaction-handler');
const { createStatistics } = require('./cashlink-statistics-handler');

const Config = require('./Config');

const Operation = {
    CHANGE_MESSAGE: 'change-message',
    CHANGE_THEME: 'change-theme',
    CREATE_IMAGES: 'create-images',
    FUND: 'fund',
    CLAIM: 'claim',
    STATISTICS: 'statistics',
};

function getCurrentDateString() {
    function padDateComponent(value) {
        return ('0' + value).slice(-2);
    }
    const date = new Date();
    return date.getFullYear() + '-'
        + padDateComponent(date.getMonth() + 1) + '-'
        + padDateComponent(date.getDate()) + '_'
        + padDateComponent(date.getHours())
        + padDateComponent(date.getMinutes());
}

function createFolder() {
    const folder = `${__dirname}/generated-cashlinks/${getCurrentDateString()}`;
    if (!fs.existsSync(folder)){
        fs.mkdirSync(folder, { recursive: true });
    }
    return folder;
}

function createCashlinks(cashlinkCount, cashlinkValue, cashlinkMessage, cashlinkTheme) {
    const cashlinks = new Map(); // token -> cashlink
    // secret salt to deterministically calculate cashlinks from random tokens
    const secretSalt = BufferUtils.fromBase64(fs.readFileSync(Config.SECRET_SALT_FILE));

    while (cashlinks.size < cashlinkCount) {
        const tokenEntropy = Config.TOKEN_LENGTH * 6; // in bit. Tokens are base64. Each base64 char encodes 6 bit.
        const randomBytes = crypto.randomBytes(Math.ceil(tokenEntropy / 8));
        const token = BufferUtils.toBase64Url(randomBytes).substring(0, Config.TOKEN_LENGTH);
        if (cashlinks.has(token)) continue;

        const tokenBytes = BufferUtils.fromBase64Url(token);
        const saltedTokenBytes = new SerialBuffer(tokenBytes.length + secretSalt.length);
        saltedTokenBytes.write(tokenBytes);
        saltedTokenBytes.write(secretSalt);
        const privateKeyBytes = Hash.light(saltedTokenBytes).serialize();
        const privateKey = PrivateKey.unserialize(privateKeyBytes);
        const keyPair = KeyPair.derive(privateKey);
        cashlinks.set(
            token,
            new Cashlink(Config.CASHLINK_BASE_URL, keyPair, cashlinkValue, cashlinkMessage, cashlinkTheme),
        );
    }
    return cashlinks;
}

let _rpcClient = null;
async function getRpcClient() {
    if (!_rpcClient) {
        _rpcClient = new RpcClient(Config.RPC_HOST, Config.RPC_PORT);
        try {
            GenesisConfig[Config.NETWORK]();
        } catch (e) {}
    }
    if (!(await _rpcClient.isConnected())) throw new Error(`Could not establish an RPC connection on ${Config.RPC_HOST}`
        + `:${Config.RPC_PORT}. Make sure the Nimiq node is running with enabled RPC.`);
    return _rpcClient;
}

async function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    const response = await new Promise((resolve) => rl.question(question, resolve));
    rl.close();
    return response;
}

async function promptCashlinkTheme(oldCashlinkTheme) {
    const cashlinkTheme = await prompt(`${oldCashlinkTheme !== undefined ? 'New ' : ''}Cashlink theme `
        + `[UNSPECIFIED/`
        + Object.keys(CashlinkTheme)
            // filter out https://www.typescriptlang.org/docs/handbook/enums.html#reverse-mappings and UNSPECIFIED
            .filter((name) => !/^(UNSPECIFIED|\d+)$/i.test(name))
            .map((name) => name.toLowerCase())
            .join('/')
        + '/0..255' // ability to specify theme as a number for themes that are not defined in HubApi yet
        + (oldCashlinkTheme !== undefined
            ? `; old theme: ${CashlinkTheme[oldCashlinkTheme].toLowerCase() || oldCashlinkTheme}` // reverse map or num
            : '')
        + ']: ',
    );
    return parseInt(cashlinkTheme)
        || CashlinkTheme[cashlinkTheme.toUpperCase()]
        || CashlinkTheme.UNSPECIFIED;
}

async function promptPrivateKey() {
    // Request backup words. Supports multiline input (pasting words separated by newlines).
    const mutableStdout = new Writable({
        write: function(chunk, encoding, callback) {
            if (!this.muted) {
                process.stdout.write(chunk, encoding);
            }
            callback();
        }
    });
    const rl = readline.createInterface({
        input: process.stdin,
        output: mutableStdout,
        terminal: true
    });

    mutableStdout.muted = false;
    rl.setPrompt('Account (backup words): ');
    rl.prompt(true);
    mutableStdout.muted = true;

    const backupWords = [];
    rl.on('line', (line) => {
        // split at whitespace and strip numbers for direct copying from Nimiq Keyguard
        backupWords.push(...line.split(/\d*\s+\d*|\d+/g).filter((word) => !!word));
        if (backupWords.length < 24) return;
        console.log(); // print new line
        rl.close();
    });

    mutableStdout.muted = true;
    return new Promise((resolve) => rl.on('close', () => {
        const extendedPrivateKey = MnemonicUtils.mnemonicToExtendedPrivateKey(backupWords.join(' '));
        const privateKey = extendedPrivateKey.derivePath(`m/44'/242'/0'/0'`).privateKey;
        resolve(privateKey);
    }));
}

async function wizardImportCashlinks() {
    let importedFile = await prompt('Do you want to create new cashlinks or load existing cashlinks?\n'
        + 'If you want to load cashlinks, specify the path to the exported csv file: ');
    if (!importedFile) return null;
    importedFile = path.resolve(importedFile);
    if (!fs.statSync(importedFile).isFile()) throw new Error(`${importedFile} is not a file.`);

    console.log('\nLoading Cashlinks');
    const folder = importedFile.substring(0, importedFile.lastIndexOf('/'));
    const { cashlinks, shortLinks, imageFiles } = importCashlinks(importedFile);
    console.log(`${cashlinks.size} Cashlinks loaded.\n`);

    return { cashlinks, shortLinks, imageFiles, folder };
}

async function wizardCreateCashlinks() {
    const cashlinkCount = parseInt(await prompt('How many Cashlinks do you want to create?: '));
    if (Number.isNaN(cashlinkCount) || cashlinkCount <= 0) throw new Error(`Invalid cashlink count ${cashlinkCount}`);
    const cashlinkValue = Math.round(parseFloat(await prompt('Cashlink value in NIM: ')) * 1e5);
    if (Number.isNaN(cashlinkValue) || cashlinkValue <= 0) throw new Error('Invalid cashlink value');
    const defaultCashlinkMessage = 'Welcome to Nimiq - Crypto for Humans';
    const cashlinkMessage = await prompt(`Cashlink message [default: "${defaultCashlinkMessage}"]: `)
        || defaultCashlinkMessage;
    const cashlinkTheme = await promptCashlinkTheme();
    const defaultShortLinkBaseUrl = 'https://nim.id/';
    const shortLinkBaseUrl = (await prompt(`Short link base url ["none"/URL, default: "${defaultShortLinkBaseUrl}"]: `)
        || defaultShortLinkBaseUrl).replace(/(?<!^none|[=?&#])\/?$/, '/');

    console.log('\nCreating Cashlinks');
    const cashlinks = createCashlinks(cashlinkCount, cashlinkValue, cashlinkMessage, cashlinkTheme);
    const shortLinks = shortLinkBaseUrl !== 'none'
        ? new Map([...cashlinks.keys()].map((token) => [token, `${shortLinkBaseUrl}${token}`]))
        : null;
    console.log(`${cashlinks.size} Cashlinks created.\n`);

    return { cashlinks, shortLinks };
}

async function wizardCreateImages(cashlinks, shortLinks, folder) {
    const format = await prompt('Choose an output format [QR/coin]: ')
    let imageFiles;
    const links = shortLinks
        || new Map([...cashlinks].map(([token, cashlink]) => [token, cashlink.render()]));
    if (format !== 'coin') {
        console.log('\nRendering QR Codes');
        imageFiles = renderQrCodes(links, folder);
        console.log('QR Codes rendered.\n');
    } else {
        console.log('\nRendering CashCoins');
        imageFiles = renderCoins(links, folder);
        console.log('CashCoins rendered.\n');
    }
    return imageFiles;
}

async function wizardChangeMessage(cashlinks) {
    const oldCashlinkMessage = cashlinks.values().next().value.message;
    const newCashlinkMessage = await prompt(`New Cashlink message [old message: "${oldCashlinkMessage}"]: `)
        || oldCashlinkMessage;
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

async function wizardChangeTheme(cashlinks) {
    const oldCashlinkTheme = cashlinks.values().next().value.theme;
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

async function wizardFundCashlinks(cashlinks) {
    const rpcClient = await getRpcClient();
    const minimumNonFreeFee = 171 * Mempool.TRANSACTION_RELAY_FEE_MIN; // 171 byte (extended tx + cashlink extra data)
    const fee = await prompt(`Funding fees [FREE/paid (${minimumNonFreeFee / 1e5} NIM per Cashlink)]: `) === 'paid'
        ? minimumNonFreeFee
        : 0;
    const totalFees = cashlinks.size * fee;
    const requiredBalance = [...cashlinks.values()].reduce((sum, cashlink) => sum + cashlink.value, 0) + totalFees;
    console.log('\nBefore funding the Cashlinks, please check the generated assets.');
    console.log('To continue with funding, please import an account via its backup words to use for funding and make '
        + `sure it holds at least ${requiredBalance / 1e5} NIM (of which ${totalFees / 1e5} NIM fees).\n`
        + 'Note that it\'s recommendable to create a new key only for this operation.');

    const privateKey = await promptPrivateKey();
    const address = PublicKey.derive(privateKey).toAddress();
    const balance = await rpcClient.getBalance(address);

    console.log(`Using address ${address.toUserFriendlyAddress()} with balance ${balance / 1e5}`);
    if (balance < requiredBalance) throw new Error('Not enough balance.');
    if (await prompt('Ok? [y/N]: ') !== 'y') {
        console.log('Not funding Cashlinks.');
        return;
    }

    console.log('\nFunding Cashlinks');
    await fundCashlinks(cashlinks, fee, privateKey, rpcClient);
    console.log('Cashlinks funded.');
}

async function wizardClaimCashlinks(cashlinks) {
    const rpcClient = await getRpcClient();
    const recipientAddress = Address.fromAny(await prompt('Redeem unclaimed Cashlinks to address: '));

    if (await prompt(`Redeeming unclaimed Cashlinks to ${recipientAddress.toUserFriendlyAddress()}, ok? [y/N]: `)
        !== 'y') {
        console.log('Not redeeming Cashlinks.');
        return;
    }

    console.log('\nRedeeming unclaimed Cashlinks');
    await claimCashlinks(cashlinks, recipientAddress, rpcClient);
    console.log('Unclaimed Cashlinks redeemed.');
}

async function wizardCreateStatistics(cashlinks, folder) {
    const rpcClient = await getRpcClient();
    const reclaimUserFriendlyAddress = await prompt('Address cashlinks have been reclaimed to [default: none]: ');
    const reclaimAddress = reclaimUserFriendlyAddress
        ? Address.fromAny(reclaimUserFriendlyAddress)
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

async function main() {
    console.log('Welcome to the cashlink generator!\n');

    let cashlinks, shortLinks, imageFiles, folder, operations;
    const importResult = await wizardImportCashlinks();
    let shouldExport = !importResult;
    if (importResult) {
        ({ cashlinks, shortLinks, imageFiles, folder } = importResult);
        const operation = await prompt(`What do you want to do? [${Object.values(Operation).join('/')}]: `);
        if (!Object.values(Operation).includes(operation)) throw new Error(`Unsupported operation ${operation}`);
        operations = [operation];
    } else {
        ({ cashlinks, shortLinks } = await wizardCreateCashlinks());
        folder = createFolder();
        operations = [Operation.CREATE_IMAGES, Operation.FUND];
    }

    if (operations.includes(Operation.CREATE_IMAGES)) {
        const oldImageFiles = imageFiles;
        imageFiles = await wizardCreateImages(cashlinks, shortLinks, folder);
        shouldExport = shouldExport || !oldImageFiles
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
        await wizardFundCashlinks(cashlinks);
    }

    if (operations.includes(Operation.CLAIM)) {
        await wizardClaimCashlinks(cashlinks);
    }

    if (operations.includes(Operation.STATISTICS)) {
        await wizardCreateStatistics(cashlinks, folder);
    }

    console.log('\nAll operations finished :)');
    if (operations.includes(Operation.FUND) || operations.includes(Operation.CLAIM)) {
        console.log(
            'Transactions might still be pending in your local node and waiting to be relayed to other network nodes.\n'
            + 'Make sure to check your wallet balance and keep your node running if needed.',
        );
    }
}

main();
