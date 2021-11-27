const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Writable = require('stream').Writable;
const {
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
const fundCashlinks = require('./fund-cashlinks');

const Config = require('./Config');

const Operation = {
    CREATE_IMAGES: 'create-images',
    FUND: 'fund',
};

function createFolder() {
    function padDateComponent(value) {
        return ('0' + value).slice(-2);
    }

    const date = new Date();
    const dateString = date.getFullYear() + '-'
        + padDateComponent(date.getMonth() + 1) + '-'
        + padDateComponent(date.getDate()) + '_'
        + padDateComponent(date.getHours())
        + padDateComponent(date.getMinutes());
    const folder = `${__dirname}/${dateString}`;
    if (!fs.existsSync(folder)){
        fs.mkdirSync(folder);
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

async function importPrivateKey() {
    return new Promise((resolve) => {
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
        // Request password.
        rl.question('Account (backup words): ', (mnemonic) => {
            rl.close();
            const extendedPrivateKey = MnemonicUtils.mnemonicToExtendedPrivateKey(mnemonic);
            const privateKey = extendedPrivateKey.derivePath(`m/44'/242'/0'/0'`).privateKey;
            resolve(privateKey);
        });
        mutableStdout.muted = true;
    });
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
    const cashlinkTheme = await prompt('Cashlink theme [UNSPECIFIED/'
        + Object.keys(CashlinkTheme)
            // filter out https://www.typescriptlang.org/docs/handbook/enums.html#reverse-mappings and UNSPECIFIED
            .filter((name) => !/^(UNSPECIFIED|\d+)$/i.test(name))
            .map((name) => name.toLowerCase())
            .join('/')
        + '/0..255]: ',
    ).then((providedTheme) => {
        return parseInt(providedTheme)
            || CashlinkTheme[providedTheme.toUpperCase()]
            || CashlinkTheme.UNSPECIFIED
    });

    console.log('\nCreating Cashlinks');
    const cashlinks = createCashlinks(cashlinkCount, cashlinkValue, cashlinkMessage, cashlinkTheme);
    const shortLinks = new Map([...cashlinks.keys()]
        .map((token) => [token, `${Config.SHORT_LINK_BASE_URL}${token}`]));
    console.log(`${cashlinks.size} Cashlinks created.\n`);

    return { cashlinks, shortLinks };
}

async function wizardCreateImages(shortLinks, folder) {
    const format = await prompt('Choose an output format [QR/coin]: ')
    let imageFiles;
    if (format !== 'coin') {
        console.log('\nRendering QR Codes');
        imageFiles = renderQrCodes(shortLinks, folder);
        console.log('QR Codes rendered.\n');
    } else {
        console.log('\nRendering CashCoins');
        imageFiles = renderCoins(shortLinks, folder);
        console.log('CashCoins rendered.\n');
    }
    return imageFiles;
}

async function wizardFundCashlinks(cashlinks) {
    const rpcClient = new RpcClient(Config.RPC_HOST, Config.RPC_PORT);
    if (!(await rpcClient.isConnected())) throw new Error(`Could not establish an RPC connection on ${Config.RPC_HOST}:`
        + `${Config.RPC_PORT}. Make sure the Nimiq node is running with enabled RPC.`);

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

    const privateKey = await importPrivateKey();
    const address = PublicKey.derive(privateKey).toAddress();
    const balance = await rpcClient.getBalance(address);

    console.log(`Using address ${address.toUserFriendlyAddress()} with balance ${balance / 1e5}`);
    if (balance < requiredBalance) throw new Error('Not enough balance.');
    if (await prompt('Ok? [y/N]: ') !== 'y') {
        console.log('Not funding Cashlinks.');
        return;
    }

    console.log('\nFunding Cashlinks');
    GenesisConfig[Config.NETWORK]();
    await fundCashlinks(cashlinks, fee, privateKey, rpcClient);
    console.log('Cashlinks funded.');
}

async function main() {
    console.log('Welcome to the printable cashlink generator!\n');

    let cashlinks, shortLinks, imageFiles, folder, operations;
    const importResult = await wizardImportCashlinks();
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
        imageFiles = await wizardCreateImages(shortLinks, folder);
    }

    if (!importResult || operations.includes(Operation.CREATE_IMAGES)) {
        // Export newly created cashlinks or if image output format might have changed
        console.log('Exporting cashlinks.');
        exportCashlinks(cashlinks, shortLinks, imageFiles, `${folder || '.'}/cashlinks.csv`);
        console.log('Cashlinks exported.\n');
    }

    if (operations.includes(Operation.FUND)) {
        await wizardFundCashlinks(cashlinks);
    }

    console.log('\nAll operations finished :)');
}

main();

// TODO support recollecting unclaimed cashlinks
// TODO support creating cashlinks without short links
// TODO error handling

