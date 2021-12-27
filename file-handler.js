const fs = require('fs');
const { Cashlink } = require('./Cashlink');

function exportCashlinks(cashlinks, shortLinks, imageFiles, file) {
    let csv = '';
    for (const [token, cashlink] of cashlinks) {
        const shortLink = shortLinks ? shortLinks.get(token) : '';
        const imageFile = imageFiles.get(token);
        csv += `${token},${shortLink},${imageFile},${cashlink.render()},${cashlink.keyPair.privateKey.toBase64()}\n`;
    }
    fs.writeFileSync(file, csv);
}

function importCashlinks(file) {
    const csv = fs.readFileSync(file).toString();
    const cashlinks = new Map();
    let shortLinks = new Map();
    const imageFiles = new Map();
    for (const entry of csv.split('\n')) {
        if (!entry) continue;
        let [token, shortLink, imageFile, cashlink] = entry.split(',');
        cashlink = Cashlink.parse(cashlink);
        cashlinks.set(token, cashlink);
        if (shortLinks === null || shortLink.trim() === '') {
            shortLinks = null;
        } else {
            shortLinks.set(token, shortLink);
        }
        imageFiles.set(token, imageFile);
    }
    if (cashlinks.size === 0) throw new Error('No cashlinks imported.');
    return { cashlinks, shortLinks, imageFiles };
}

module.exports = { exportCashlinks, importCashlinks };

