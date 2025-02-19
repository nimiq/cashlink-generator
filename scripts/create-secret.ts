import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { BufferUtils } from '@nimiq/core';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ENV_FILE = path.join(__dirname, '../.env');
const SECRET_SALT_LENGTH = 128; // overkill, but also doesn't hurt

async function promptUser(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function createSecret(): Promise<void> {
    let envContent = '';
    let existingSalt = '';

    // Read existing .env file if it exists
    if (fs.existsSync(ENV_FILE)) {
        envContent = fs.readFileSync(ENV_FILE, 'utf8');
        const saltMatch = envContent.match(/^SALT=(.*)$/m);
        if (saltMatch) {
            existingSalt = saltMatch[1];
            const replace = await promptUser('Existing salt found. Do you want to replace it? [y/N]: ');
            if (replace.toLowerCase() !== 'y') {
                console.log('Keeping existing salt.');
                return;
            }
        }
    }

    // Generate new salt
    const secretBytes = crypto.randomBytes(SECRET_SALT_LENGTH);
    const secretBase64 = BufferUtils.toBase64(secretBytes);

    // Update or create .env file
    if (existingSalt) {
        // Replace existing salt
        envContent = envContent.replace(/^SALT=.*$/m, `SALT=${secretBase64}`);
    } else {
        // Add new salt to existing content or create new content with correct defaults
        const defaultEnv = '# Nimiq Node IP address\n'
            + 'NODE_IP=127.0.0.1\n'
            + '\n'
            + '# Nimiq Node RPC port\n'
            + 'NODE_PORT=8648\n'
            + '\n'
            + '# Network to use (main/test)\n'
            + 'NETWORK=test\n'
            + '\n'
            + '# Length of cashlink tokens in characters\n'
            + 'TOKEN_LENGTH=6\n'
            + '\n'
            + '# Salt for cashlink generation (base64 encoded). Must be kept secret.\n'
            + `SALT=${secretBase64}\n`;
        envContent = envContent || defaultEnv;
    }

    // Write to .env file
    fs.writeFileSync(ENV_FILE, envContent);
    console.log(`Secret salt ${existingSalt ? 'updated' : 'created'} in .env file`);
    console.log(`New salt: ${secretBase64}`);
}

// Execute immediately
createSecret().catch((error) => {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
});
