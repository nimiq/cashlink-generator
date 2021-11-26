const { createCanvas } = require('canvas');
const fs = require('fs');
const readline = require('readline');
const QrCode = require('./qr-code');

const QR_SIZE = 400;
const QR_PADDING = 60;

function initCanvas() {
    const canvasSize = QR_SIZE + 2 * QR_PADDING;
    let canvas = createCanvas(canvasSize, canvasSize, 'svg');
    let context = canvas.getContext('2d');
    context.quality = 'best';
    context.patternQuality = 'best'; // Affects pattern (gradient, image, etc.) rendering quality.
    return { canvas, context };
}

function createQrCode(filepath, text, { fill= '#1F2348', ...remainingOptions } = {}) {
    const { canvas } = initCanvas();
    QrCode.render({
        size: QR_SIZE,
        left: QR_PADDING,
        top: QR_PADDING,
        text,
        fill,
        ...remainingOptions,
    }, canvas);
    fs.writeFileSync(filepath, canvas.toBuffer());
}

function renderQrCodes(links, folder, options = {}) {
    const filenames = new Map();
    for (const [token, link] of links) {
        const filename = `qr-${token}.svg`;
        filenames.set(token, filename);
        createQrCode(`${folder || '.'}/${filename}`, link, options);
    }
    return filenames;
}

// Check whether we're run as an imported module or directly via `node render-qr-codes.js`.
// See https://nodejs.org/docs/latest/api/modules.html#modules_accessing_the_main_module
if (require.main === module) {
    // We're run as `node render-qr-codes.js`.
    // Provide a little utility for rendering a single qr code in Nimiq style.
    (async () => {
        console.log('Create a Nimiq style QR code by providing its content and filename.');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });
        const content = await new Promise((resolve) => rl.question('QR Content: ', resolve));
        const color = await new Promise((resolve) =>
            rl.question('Color (light-blue/indigo; default indigo): ', resolve)) || 'indigo';
        const errorCorrection = await new Promise((resolve) =>
            rl.question('Error Correction (L/M/Q/H; default M): ', resolve)) || 'M';
        let filename = `${content.replace(/https?:\/\//, '').replace(/[^A-Z0-9]+/gi, '-')}-${color}-${errorCorrection}`;
        filename = await new Promise((resolve) => rl.question(`Filename (default ${filename}): `, resolve))
            || filename;
        const filepath = `${__dirname}/${filename}`.replace(/(\.svg)?$/, '.svg');
        rl.close();
        createQrCode(filepath, content, {
            fill: {
                type: 'radial-gradient',
                // circle centered in bottom right corner with radius of the size of qr code diagonal
                position: [1, 1, 0, 1, 1, Math.sqrt(2)],
                colorStops: color === 'light-blue'
                    ? [[0, '#265DD7'], [1, '#0582CA']]
                    : [[0, '#260133'], [1, '#1F2348']],
            },
            ecLevel: errorCorrection,
        });
        console.log(`QR code saved to ${filepath}.`);
    })();
} else {
    // We're an imported module.
    module.exports = renderQrCodes;
}

