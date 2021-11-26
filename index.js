const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');
const Writable = require('stream').Writable;
const { GenesisConfig, KeyPair, PrivateKey, PublicKey, BufferUtils, SerialBuffer, Hash, MnemonicUtils } = require('@nimiq/core');
const { Cashlink } = require('./Cashlink');
const { importCashlinks, exportCashlinks } = require('./file-handler');
const renderCoins = require('./render-coins');
const renderQrCodes = require('./render-qr-codes');
const RpcClient = require('./RpcClient');
const fundCashlinks = require('./fund-cashlinks');

const Config = require('./Config');

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

function createCashlinks() {
    const cashlinks = new Map(); // token -> cashlink
    // secret salt to deterministically calculate cashlinks from random tokens
    const secretSalt = BufferUtils.fromBase64(fs.readFileSync(Config.SECRET_SALT_FILE));

    while (cashlinks.size < Config.CASHLINK_COUNT) {
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
            new Cashlink(Config.CASHLINK_BASE_URL, keyPair, Config.CASHLINK_VALUE, Config.CASHLINK_MESSAGE),
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

async function main() {
    console.log('Welcome to the printable cashlink generator!\n');

    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    let importedFile = await new Promise((resolve) =>
        rl.question('Do you want to create new cashlinks or load existing cashlinks?\n' +
            'If you want to load cashlinks, specify the path to the exported csv file: ', (path) => resolve(path))
    );

    let folder, cashlinks, shortLinks, imageFiles;
    if (importedFile) {
        if (!fs.existsSync(importedFile)) throw new Error(`File ${importedFile} not found.`);
        folder = importedFile.substring(0, importedFile.lastIndexOf('/'));
        console.log('\nLoading Cashlinks');
        ({ cashlinks, shortLinks, imageFiles } = importCashlinks(importedFile));
        console.log('Cashlinks loaded.\n');
    } else {
        folder = createFolder();
        console.log('\nCreating Cashlinks');
        cashlinks = createCashlinks();
        shortLinks = new Map([...cashlinks.keys()]
            .map((token) => [token, `${Config.SHORT_LINK_BASE_URL}${token}`]));
        console.log('Cashlinks created.\n');
    }

    const createImages = !importedFile || await new Promise((resolve) => {
        rl.question('You imported Cashlinks for which already images have been generated.\n' +
            'Do you want to recreate the images? [y/N]: ', (answer) => resolve(answer === 'y'));
    });
    if (createImages) {
        if (Config.OUTPUT === 'QR') {
            console.log('\nRendering QR Codes');
            imageFiles = renderQrCodes(shortLinks, folder);
            console.log('QR Codes rendered.\n');
        } else {
            console.log('\nRendering CashCoins');
            imageFiles = renderCoins(shortLinks, folder);
            console.log('CashCoins rendered.\n');
        }
    }

    if (!importedFile || createImages) { // when images recreated, reexport as image output might have changed
        console.log('Exporting cashlinks.');
        exportCashlinks(cashlinks, shortLinks, imageFiles, `${folder || '.'}/cashlinks.csv`);
        console.log('Cashlinks exported.\n');
    }

    const rpcClient = new RpcClient(Config.RPC_HOST, Config.RPC_PORT);
    if (!(await rpcClient.isConnected())) throw new Error(`Could not establish an RPC connection on ${Config.RPC_HOST}:`
        + `${Config.RPC_PORT}. Make sure the RPC client is running.`);

    const requiredBalance = cashlinks.size * (cashlinks.values().next().value.value + Config.TRANSACTION_FEE);
    console.log('All assets for the generated Cashlinks have been created. Please check them now.');
    console.log('To continue with funding the Cashlinks, please import an account via its backup words '
        + 'to use for funding and make sure it holds at least '
        + (requiredBalance /1e5) + ' NIM.\n'
        + 'Note that it\'s recommendable to create a new key only for this operation.');

    rl.close(); // close old rl for mutable private key rl
    const privateKey = await importPrivateKey();
    const address = PublicKey.derive(privateKey).toAddress();
    const balance = await rpcClient.getBalance(address);

    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });
    console.log(`Using address ${address.toUserFriendlyAddress()} with balance ${balance / 1e5}`);
    if (balance < requiredBalance) throw new Error('Not enough balance.');
    if (!(await new Promise((resolve) =>
        rl.question('Ok? [y/N]: ', (answer) => resolve(answer === 'y'))))) return;
    rl.close();

    console.log('Funding Cashlinks');
    GenesisConfig[Config.NETWORK]();
    await fundCashlinks(cashlinks, Config.TRANSACTION_FEE, privateKey, rpcClient);
    console.log('Cashlinks funded.');
}

main();

// TODO support recollecting unclaimed cashlinks
// TODO turn the main method into a wizard
// TODO support creating cashlinks without short links
// TODO error handling

