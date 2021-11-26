const Config = {
    NETWORK: 'main',

    SHORT_LINK_BASE_URL: 'https://nim.id/',

    TOKEN_LENGTH: 6, // length in characters
    SECRET_SALT_FILE: './secret/salt',

    OUTPUT: 'QR', // QR or Coin
    CASHLINK_COUNT: 2000,
    CASHLINK_VALUE: 1000e5,
    CASHLINK_MESSAGE: 'Welcome to Nimiq - Crypto for Humans',
    // has to be more than 1 luna per byte to not be considered free, thus should be at least 171 luna for creating a
    // Cashlink funding tx with its extra data as extended transaction
    TRANSACTION_FEE: 171,
    
    RPC_HOST: '127.0.0.1',
    RPC_PORT: 8648,
};
Config.CASHLINK_BASE_URL = `https://hub.nimiq${Config.NETWORK === 'main' ? '' : '-testnet'}.com/cashlink/`;

module.exports = Config;

