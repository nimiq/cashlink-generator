/**
 * Nimiq Cashlink Core Implementation
 * Handles the creation, serialization, and management of Nimiq cashlinks.
 *
 * Features:
 * - Create and parse cashlinks
 * - Handle message encoding/decoding
 * - Support multiple themes
 * - Manage serialization format
 * - Handle key pair management
 *
 * The cashlink class is the core component for cashlink generation and handling.
 */

import { NumberUtils, SerialBuffer, BufferUtils, KeyPair, PrivateKey, Address } from '@nimiq/core';

/**
 * Available themes for cashlink customization
 */
export enum CashlinkTheme {
    UNSPECIFIED = 0,
    STANDARD = 1,
    CHRISTMAS = 2,
    LUNAR_NEW_YEAR = 3,
    EASTER = 4,
    GENERIC = 5,
    BIRTHDAY = 6,
}

/**
 * Extra data fields for cashlink transactions
 */
export const CashlinkExtraData = {
    FUNDING: new Uint8Array([0, 130, 128, 146, 135]), // 'CASH'.split('').map((c) => c.charCodeAt(0) + 63)
    CLAIMING: new Uint8Array([0, 139, 136, 141, 138]), // 'LINK'.split('').map((c) => c.charCodeAt(0) + 63)
} as const;

/**
 * Core cashlink class for creating and managing Nimiq cashlinks
 * Handles the creation, modification, and serialization of cashlinks
 */
export class Cashlink {
    private static _textEncoder = new TextEncoder();
    private static _textDecoder = new TextDecoder();
    private _baseUrl: string;
    private _keyPair: KeyPair;
    private _value: number;
    private _messageBytes: Uint8Array = new Uint8Array();
    private _theme: number = CashlinkTheme.UNSPECIFIED;

    /**
     * Parse a cashlink from its string representation
     * @param str - Cashlink URL string to parse
     * @returns New Cashlink instance
     */
    static parse(str: string): Cashlink {
        const [baseUrl, rawHash] = str.split('#');
        const hash = rawHash.replace(/~/g, '')
            .replace(/=*$/, (match) => new Array(match.length).fill('.').join(''));
        const buf = BufferUtils.fromBase64Url(hash);

        // Ensure we preserve the /cashlink/ part in the URL if it exists
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const finalBaseUrl = normalizedBaseUrl.includes('/cashlink') ?
            normalizedBaseUrl :
            `${normalizedBaseUrl}/cashlink`;

        const keyPair = KeyPair.derive(PrivateKey.deserialize(buf));
        const value = buf.readUint64();
        let message = '';
        if (buf.readPos !== buf.byteLength) {
            const messageLength = buf.readUint8();
            const messageBytes = buf.read(messageLength);
            message = Cashlink._textDecoder.decode(messageBytes);
        }
        let theme;
        if (buf.readPos < buf.byteLength) {
            theme = buf.readUint8();
        }

        return new Cashlink(finalBaseUrl, keyPair, value, message, theme);
    }

    /**
     * Create a new cashlink instance
     * @param baseUrl - Base URL for cashlink
     * @param keyPair - KeyPair for the cashlink
     * @param value - Value in luna (1 NIM = 100000 luna)
     * @param message - Optional message to include
     * @param theme - Optional theme identifier
     */
    constructor(
        baseUrl: string,
        keyPair: KeyPair,
        value: number /*luna*/,
        message: string = '',
        theme: number = CashlinkTheme.UNSPECIFIED,
    ) {
        this._baseUrl = baseUrl;
        this._keyPair = keyPair;
        this._value = value;
        this.message = message;
        this.theme = theme;
    }

    /** Get the value in luna */
    get value(): number {
        return this._value;
    }

    /** Get/Set the message text */
    get message(): string {
        return Cashlink._textDecoder.decode(this._messageBytes);
    }

    set message(message: string) {
        const messageBytes = Cashlink._textEncoder.encode(message);
        if (!NumberUtils.isUint8(messageBytes.byteLength)) {
            throw new Error('Cashlink message is too long');
        }
        this._messageBytes = messageBytes;
    }

    /** Get/Set the theme */
    get theme(): number {
        return this._theme;
    }

    set theme(theme: number) {
        if (!NumberUtils.isUint8(theme)) {
            throw new Error(`Invalid theme ${theme}`);
        }
        this._theme = theme;
    }

    /** Get the cashlink address */
    get address(): Address {
        return this._keyPair.publicKey.toAddress();
    }

    /** Get the cashlink keypair */
    get keyPair(): KeyPair {
        return this._keyPair;
    }

    /**
     * Render the cashlink as a URL string
     * Handles serialization and URL-safe encoding
     * @returns Complete cashlink URL
     */
    render(): string {
        const buf = new SerialBuffer(
            /*key*/ this._keyPair.privateKey.serializedSize +
            /*value*/ 8 +
            /*message length*/ (this._messageBytes.byteLength || this._theme ? 1 : 0) +
            /*message*/ this._messageBytes.byteLength +
            /*theme*/ (this._theme ? 1 : 0),
        );

        buf.write(this._keyPair.privateKey.serialize());
        buf.writeUint64(this._value);
        if (this._messageBytes.byteLength || this._theme) {
            buf.writeUint8(this._messageBytes.byteLength);
            buf.write(this._messageBytes);
        }
        if (this._theme) {
            buf.writeUint8(this._theme);
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
