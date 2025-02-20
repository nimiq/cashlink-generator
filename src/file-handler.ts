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
        const [token, shortLink, imageFile, cashlinkUrl] = line.split(',');

        try {
            const cashlink = Cashlink.parse(cashlinkUrl);

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
        const privateKeyBase64 = BufferUtils.toBase64(cashlink.keyPair.privateKey.serialize());

        return `${token},${shortLink},${imageFile},${cashlinkUrl},${privateKeyBase64}`;
    });

    fs.writeFileSync(file, lines.join('\n'));
}
