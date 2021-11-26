const Config = {
    NETWORK: 'main',

    SHORT_LINK_BASE_URL: 'https://nim.id/',
};
Config.CASHLINK_BASE_URL = `https://hub.nimiq${Config.NETWORK === 'main' ? '' : '-testnet'}.com/cashlink/`;

module.exports = Config;

