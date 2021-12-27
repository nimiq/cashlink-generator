const fs = require('fs');
const crypto = require('crypto');
const { BufferUtils } = require('@nimiq/core');
const { SECRET_SALT_FILE } = require('./Config');

const SECRET_SALT_LENGTH = 128; // overkill, but also doesn't hurt

function createSecret() {
    if (fs.existsSync(SECRET_SALT_FILE)) {
        console.warn(`Secret salt file ${SECRET_SALT_FILE} already exists. Will not overwrite.`);
        return;
    }
    const secretBytes = crypto.randomBytes(SECRET_SALT_LENGTH);
    const secretBase64 = BufferUtils.toBase64(secretBytes);
    fs.writeFileSync(SECRET_SALT_FILE, secretBase64);
    console.log(`Secret salt file created at ${SECRET_SALT_FILE}`);
}

createSecret();
