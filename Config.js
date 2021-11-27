const Config = {
    NETWORK: 'main',

    SHORT_LINK_BASE_URL: 'https://nim.id/',

    TOKEN_LENGTH: 6, // length in characters
    SECRET_SALT_FILE: './secret/salt',

    RPC_HOST: '127.0.0.1',
    RPC_PORT: 8648,
};
Config.CASHLINK_BASE_URL = `https://hub.nimiq${Config.NETWORK === 'main' ? '' : '-testnet'}.com/cashlink/`;

module.exports = Config;

