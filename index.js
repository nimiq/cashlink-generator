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

const OUTPUT = 'QR'; // QR or Coin

const CASHLINK_COUNT = 2000;
const CASHLINK_VALUE = 1000e5;
// const CASHLINK_MESSAGE = 'Welcome to Nimiq, the Browser-first blockchain.';
const CASHLINK_MESSAGE = 'Welcome to Nimiq - Crypto for Humans';

const RPC_HOST = '127.0.0.1';
const RPC_PORT = 8648;

// has to be more than 1 luna per byte to not be considered free, thus should be at least 171 luna for creating a
// Cashlink funding tx with its extra data as extended transaction
const TRANSACTION_FEE = 171;

// secret salt to deterministically calculate cashlinks from random tokens
const SECRET_SALT = BufferUtils.fromBase64(fs.readFileSync('./secret/salt'));
const TOKEN_LENGTH = 6; // length in characters
const TOKEN_ENTROPY = TOKEN_LENGTH * 6; // in bit. The tokens are encoded as base64. Each base64 char encodes 6 bit.

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

    while (cashlinks.size < CASHLINK_COUNT) {
        const randomBytes = crypto.randomBytes(Math.ceil(TOKEN_ENTROPY / 8));
        const token = BufferUtils.toBase64Url(randomBytes).substring(0, TOKEN_LENGTH);
        if (cashlinks.has(token)) continue;

        const tokenBytes = BufferUtils.fromBase64Url(token);
        const saltedTokenBytes = new SerialBuffer(tokenBytes.length + SECRET_SALT.length);
        saltedTokenBytes.write(tokenBytes);
        saltedTokenBytes.write(SECRET_SALT);
        const privateKeyBytes = Hash.light(saltedTokenBytes).serialize();
        const privateKey = PrivateKey.unserialize(privateKeyBytes);
        const keyPair = KeyPair.derive(privateKey);
        cashlinks.set(token, new Cashlink(Config.CASHLINK_BASE_URL, keyPair, CASHLINK_VALUE, CASHLINK_MESSAGE));
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
        if (OUTPUT === 'QR') {
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
        exportCashlinks(cashlinks, shortLinks, imageFiles, `${folder}/cashlinks.csv`);
        console.log('Cashlinks exported.\n');
    }

    const rpcClient = new RpcClient(RPC_HOST, RPC_PORT);
    if (!(await rpcClient.isConnected())) throw new Error(`Could not establish an RPC connection on ${RPC_HOST}:`
        + `${RPC_PORT}. Make sure the RPC client is running.`);

    const requiredBalance = cashlinks.size * (cashlinks.values().next().value.value + TRANSACTION_FEE);
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
    await fundCashlinks(cashlinks, TRANSACTION_FEE, privateKey, rpcClient);
    console.log('Cashlinks funded.');
}

main();

// TODO support recollecting unclaimed cashlinks
// TODO turn the main method into a wizard
// TODO support creating cashlinks without short links
// TODO error handling

