/**
 * Nimiq QR Code Generator
 * Generates SVG QR codes with Nimiq styling and gradient options.
 *
 * Features:
 * - Creates SVG-based QR codes
 * - Supports Nimiq's brand colors and gradients
 * - Configurable error correction levels
 * - Custom fill options including radial/linear gradients
 * - CLI interface for single QR code generation
 *
 * The generator supports both programmatic usage and CLI operation.
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createCanvas, type Canvas, type CanvasRenderingContext2D } from 'canvas';
import QrCode from './qr-code.ts';
import { prompt } from './utils.ts';

/**
 * Canvas size and padding configuration
 */
const QR_SIZE = 400;
const QR_PADDING = 60;

/**
 * Interface for canvas initialization result
 */
interface CanvasInit {
    canvas: Canvas;
    context: CanvasRenderingContext2D;
}

/**
 * QR code rendering options
 */
interface QROptions {
    fill?: string | {
        type: 'radial-gradient' | 'linear-gradient';
        position: number[];
        colorStops: [number, string][];
    };
    ecLevel?: 'L' | 'M' | 'Q' | 'H';
    [key: string]: any;
}

/**
 * Initializes a canvas for QR code rendering
 * @returns Canvas and context configured for best quality
 */
function initCanvas(): CanvasInit {
    const canvasSize = QR_SIZE + 2 * QR_PADDING;
    const canvas = createCanvas(canvasSize, canvasSize, 'svg');
    const context = canvas.getContext('2d');
    context.quality = 'best';
    context.patternQuality = 'best'; // Affects pattern (gradient, image, etc.) rendering quality.
    return { canvas, context };
}

/**
 * Creates a single QR code with specified options
 * @param filepath - Output file path
 * @param text - Content to encode in QR code
 * @param options - Rendering options including fill and error correction
 */
function createQrCode(filepath: string, text: string, { fill = '#1F2348', ...remainingOptions }: QROptions = {}): void {
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

/**
 * Renders multiple QR codes from a map of links
 * @param links - Map of tokens to URLs
 * @param folder - Output directory for generated files
 * @param options - Rendering options
 * @returns Map of tokens to generated filenames
 */
export default function renderQrCodes(
    links: Map<string, string>,
    folder: string,
    options: QROptions = {},
): Map<string, string> {
    const filenames = new Map<string, string>();
    for (const [token, link] of links) {
        const filename = `qr-${token}.svg`;
        filenames.set(token, filename);
        createQrCode(`${folder || '.'}/${filename}`, link, options);
    }
    return filenames;
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
    // We're run directly
    // Provide a little utility for rendering a single QR code in Nimiq style.
    (async () => {
        console.log('Create a Nimiq style QR code by providing its content and filename.');
        const content = await prompt('QR Content: ');
        const color = await prompt('Color (light-blue/indigo; default indigo): ') || 'indigo';
        const errorCorrection = await prompt('Error Correction (L/M/Q/H; default M): ') || 'M';

        let filename = `${content.replace(/https?:\/\//, '').replace(/[^A-Z0-9]+/gi, '-')}-${color}-${errorCorrection}`;
        filename = await prompt(`Filename (default ${filename}): `) || filename;

        const currentDir = dirname(fileURLToPath(import.meta.url));
        const qrDir = join(currentDir, '..', 'generated-qr');

        // Create directory if it doesn't exist
        if (!fs.existsSync(qrDir)) {
            fs.mkdirSync(qrDir, { recursive: true });
        }

        const filepath = join(qrDir, filename).replace(/(\.svg)?$/, '.svg');

        createQrCode(filepath, content, {
            fill: {
                type: 'radial-gradient',
                // circle centered in bottom right corner with radius of the size of qr code diagonal
                position: [1, 1, 0, 1, 1, Math.sqrt(2)],
                colorStops: color === 'light-blue'
                    ? [[0, '#265DD7'], [1, '#0582CA']]
                    : [[0, '#260133'], [1, '#1F2348']],
            },
            ecLevel: errorCorrection as 'L' | 'M' | 'Q' | 'H',
        });
        console.log(`QR code saved to ${filepath}.`);
    })();
}
