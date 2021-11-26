const { NumberUtils, SerialBuffer, BufferUtils, KeyPair, PrivateKey } = require('@nimiq/core');
const { Utf8Tools } = require('@nimiq/utils');

const CashlinkExtraData = {
    FUNDING:  new Uint8Array([0, 130, 128, 146, 135]), // 'CASH'.split('').map(c => c.charCodeAt(0) + 63)
    CLAIMING: new Uint8Array([0, 139, 136, 141, 138]), // 'LINK'.split('').map(c => c.charCodeAt(0) + 63)
};

class Cashlink {
    static parse(str) {
        let [ baseUrl, hash ] = str.split('#');
        hash = hash.replace(/~/g, '')
            .replace(/=*$/, (match) => new Array(match.length).fill('.').join(''));
        const buf = BufferUtils.fromBase64Url(hash);
        const keyPair = KeyPair.derive(PrivateKey.unserialize(buf));
        const value = buf.readUint64();
        let message;
        if (buf.readPos === buf.byteLength) {
            message = '';
        } else {
            const messageLength = buf.readUint8();
            const messageBytes = buf.read(messageLength);
            message = Utf8Tools.utf8ByteArrayToString(messageBytes);
        }

        return new Cashlink(baseUrl, keyPair, value, message);
    }

    constructor(baseUrl, keyPair, value /*luna*/, message = '') {
        this._baseUrl = baseUrl;
        this._keyPair = keyPair;
        this._value = value;
        this._message = message;
    }

    get value() {
        return this._value;
    }

    get message() {
        return this._message;
    }

    get address() {
        return this._keyPair.publicKey.toAddress();
    }

    get keyPair() {
        return this._keyPair;
    }

    render() {
        const messageBytes = Utf8Tools.stringToUtf8ByteArray(this._message);
        if (!NumberUtils.isUint8(messageBytes.byteLength)) throw new Error('Message is too long');

        const buf = new SerialBuffer(
            /*key*/ this._keyPair.privateKey.serializedSize +
            /*value*/ 8 +
            /*message length*/ (messageBytes.byteLength ? 1 : 0) +
            /*message*/ messageBytes.byteLength,
        );

        this._keyPair.privateKey.serialize(buf);
        buf.writeUint64(this._value);
        if (messageBytes.byteLength) {
            buf.writeUint8(messageBytes.byteLength);
            buf.write(messageBytes);
        }

        let result = BufferUtils.toBase64Url(buf);
        // replace trailing . by = because of URL parsing issues on iPhone.
        result = result.replace(/\./g, '=');
        // iPhone also has a problem to parse long words with more then 300 chars in a URL in WhatsApp
        // (and possibly others). Therefore we break the words by adding a ~ every 256 characters in long words.
        result = result.replace(/[A-Za-z0-9_]{257,}/g, (match) => match.replace(/.{256}/g, '$&~'));

        return `${this._baseUrl}#${result}`;
    }
}

module.exports = { Cashlink, CashlinkExtraData };
