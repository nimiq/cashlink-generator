/**
 * Nimiq Cashlink File Handler
 * Manages import and export of cashlinks to/from CSV files.
 *
 * Features:
 * - Import cashlinks from CSV
 * - Export cashlinks to CSV
 * - Handle private key serialization
 * - Manage image file references
 * - Support short links
 *
 * The file handler ensures proper persistence and loading of cashlink data.
 */

import fs from 'fs';
import { PrivateKey, KeyPair } from '@nimiq/core';
import { BufferUtils } from '@nimiq/core';
import { Cashlink } from './cashlink';

/**
 * Data structure for imported cashlink information
 */
interface ImportedData {
    cashlinks: Map</* token id */ string, Cashlink>;
    shortLinks: Map</* token id */ string, /* link */ string>;
    imageFiles: Map</* token id */ string, /* filename */ string>;
}

/**
 * Imports cashlinks from a CSV file
 * @param file - Path to CSV file
 * @returns Imported cashlink data including short links and image files
 * @throws If CSV file is malformed or contains invalid data
 */
export function importCashlinks(file: string): ImportedData {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n');

    const cashlinks = new Map<string, Cashlink>();
    const shortLinks = new Map<string, string>();
    const imageFiles = new Map<string, string>();

    for (const line of lines) {
        const [token, shortLink, imageFile, cashlinkUrl, privateKeyBase64] = line.split(',');

        try {
            // Extract private key from base64
            const privateKeyBytes = BufferUtils.fromBase64Url(privateKeyBase64);
            const privateKey = PrivateKey.deserialize(privateKeyBytes);
            const keyPair = KeyPair.derive(privateKey);

            // Parse the cashlink URL to get parameters
            const url = new URL(cashlinkUrl);
            const hashPart = url.hash.substring(1); // Remove leading #
            const [encodedData] = hashPart.split(',');
            const decodedData = BufferUtils.fromBase64Url(encodedData);

            // Create a proper SerialBuffer to correctly read the uint64 value
            const privateKeySize = privateKey.serializedSize;
            decodedData.read(privateKeySize); // Skip the private key bytes
            const value = decodedData.readUint64(); // Correctly read the 64-bit value

            // Read message if present
            let message = '';
            if (decodedData.readPos < decodedData.byteLength) {
                const messageLength = decodedData.readUint8();
                const messageBytes = decodedData.read(messageLength);
                message = new TextDecoder().decode(messageBytes);
            }

            // Create cashlink with parsed data
            const cashlink = new Cashlink(
                cashlinkUrl.split('#')[0],
                keyPair,
                value,
                message,
            );

            cashlinks.set(token, cashlink);
            if (shortLink !== '') shortLinks.set(token, shortLink);
            if (imageFile !== '') imageFiles.set(token, imageFile);
        } catch (e) {
            console.error(`Failed to parse line: ${line}`);
            console.error('Error:', e);
            throw new Error('Malformed value in CSV file');
        }
    }

    if (cashlinks.size === 0) throw new Error('No cashlinks imported.');
    return { cashlinks, shortLinks, imageFiles };
}

/**
 * Exports cashlinks to a CSV file
 * @param cashlinks - Map of cashlinks to export
 * @param shortLinks - Optional map of short links
 * @param imageFiles - Map of image file references
 * @param file - Output file path
 */
export function exportCashlinks(
    cashlinks: Map<string, Cashlink>,
    shortLinks: Map<string, string> | null,
    imageFiles: Map<string, string>,
    file: string,
): void {
    const lines = [...cashlinks].map(([token, cashlink]) => {
        const shortLink = shortLinks?.get(token) || '';
        const imageFile = imageFiles.get(token) || '';
        const cashlinkUrl = cashlink.render();
        const privateKeyBase64 = BufferUtils.toBase64Url(cashlink.keyPair.privateKey.serialize());

        return `${token},${shortLink},${imageFile},${cashlinkUrl},${privateKeyBase64}`;
    });

    fs.writeFileSync(file, lines.join('\n'));
}
