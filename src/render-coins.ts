/**
 * Nimiq Cashlink Coin Renderer
 * Generates printable hexagonal coin designs with QR codes for Nimiq cashlinks.
 *
 * Features:
 * - Creates SVG-based coin designs
 * - Supports both front and back side rendering
 * - Customizable hexagon size and layout
 * - QR code integration
 * - Support for compact and standard layouts
 *
 * The renderer supports both single coin generation and batch processing.
 */

import fs from 'fs';
import { createCanvas, registerFont, type Canvas, type CanvasRenderingContext2D } from 'canvas';
import { Cashlink } from './cashlink';
import QrCode from './qr-code';

// US letter format at 400 dpi
// const CANVAS_WIDTH = 8.5 * 400;
// const CANVAS_HEIGHT = 11 * 400;

// DIN A4 at 400 dpi
const CANVAS_WIDTH = 8.27 * 400;
const CANVAS_HEIGHT = 11.6 * 400;

const HEXAGON_MARGIN = 0;
const HEXAGON_RADIUS = 400;
const BORDER_RADIUS = HEXAGON_RADIUS / 50 * 9;
const QR_SIZE = HEXAGON_RADIUS * .9;
const HEADER_FONT_SIZE = HEXAGON_RADIUS / 50 * 9.5;
const LINK_FONT_SIZE = HEXAGON_RADIUS / 50 * 5;
const BACK_LOGO_SIZE = calculateHexHeight(HEXAGON_RADIUS) * (1 - 1 / 1.618); // golden ratio

const RENDER_COMPACT = false;
const RENDER_OUTLINE_ONLY = true;

interface Point {
    start: [number, number];
    end: [number, number];
}

interface Arc {
    center: [number, number];
    startAngle: number;
    endAngle: number;
}

registerFont('fonts/Muli.ttf', { family: 'Muli' });
registerFont('fonts/Muli-SemiBold.ttf', { family: 'Muli-SemiBold' });
registerFont('fonts/FiraMono-Regular.ttf', { family: 'Fira Mono' });

/**
 * Initializes the canvas with proper settings
 * @returns Canvas and context with best quality settings
 */
function initCanvas(): { canvas: Canvas; context: CanvasRenderingContext2D } {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT, 'svg');
    const context = canvas.getContext('2d');
    context.quality = 'best';
    context.patternQuality = 'best'; // Affects pattern (gradient, image, etc.) rendering quality.
    return { canvas, context };
}

/**
 * Calculates the height of a hexagon given its radius
 * @param hexRadius - Radius of the hexagon
 * @returns Height of the hexagon
 */
function calculateHexHeight(hexRadius: number): number {
    return Math.sqrt(3) * hexRadius;
}

/**
 * Draws a hexagonal shape with rounded corners
 * @param centerX - X coordinate of hexagon center
 * @param centerY - Y coordinate of hexagon center
 * @param radius - Radius of the hexagon
 * @param borderRadius - Radius of corner rounding
 * @param context - Canvas rendering context
 */
function drawHexagon(
    centerX: number,
    centerY: number,
    radius: number,
    borderRadius: number,
    context: CanvasRenderingContext2D,
): void {
    // Inspired by nimiqode HexagonRing.
    // Note that the radius is the same as the full side lengths.
    const height = calculateHexHeight(radius);

    // Corners of the hexagon if it wouldn't be rounded.
    const virtualCorners: [number, number][] = [
        [centerX + radius / 2, centerY + height / 2], // right bottom
        [centerX + radius, centerY + 0], // right center
        [centerX + radius / 2, centerY + -height / 2], // right top
        [centerX + -radius / 2, centerY + -height / 2], // left top
        [centerX + -radius, centerY + 0], // left center
        [centerX + -radius / 2, centerY + height / 2], // left bottom
    ];

    // The corners of the hexagon are rounded therefore there is an offset until where the sides are straight and
    // then change into an arc. Calculate the side offset and arc center by a right triangle formed by the
    // virtual corner, the center of the arc and one arc end point. This is a right triangle as the arc smoothly
    // joins into the hexagon side by design und thus at the arc end point we have a right angle between the
    // hexagon side and the perpendicular to the arc center.
    // The center point of the arc is located on the straight line through the hexagon center (origin) and the
    // virtual corner as this line is exactly between the two arc end points (perpendicular bisect).
    // The angle of the arc is 60 degrees (a sixth of a full circle, 2*PI/6), thus the angle in the triangle at
    // the perpendicular bisect that halves the arc is 2*PI/12 = PI/6.
    // With this, we can compute the sides of the right triangle from the known angle and know distance between
    // center point and arc end point (the radius).
    const sideOffset = Math.tan(Math.PI / 6) * borderRadius; // line from virtual corner to arc end point
    const relativeSideOffset = sideOffset / radius;
    const cornerArcOffset = borderRadius / Math.cos(Math.PI / 6); // line from virtual corner to arc center
    const relativeCornerArcOffset = cornerArcOffset / radius;

    // compute lines
    const lines: Point[] = [];
    for (let i = 0; i < 6; ++i) {
        const j = (i + 1) % 6;
        const lineDelta: [number, number] = [
            virtualCorners[j][0] - virtualCorners[i][0],
            virtualCorners[j][1] - virtualCorners[i][1],
        ];
        const start: [number, number] = [
            virtualCorners[i][0] + relativeSideOffset * lineDelta[0],
            virtualCorners[i][1] + relativeSideOffset * lineDelta[1],
        ];
        const end: [number, number] = [
            virtualCorners[j][0] - relativeSideOffset * lineDelta[0],
            virtualCorners[j][1] - relativeSideOffset * lineDelta[1],
        ];
        lines.push({ start, end });
    }

    // to convert arc points to angles
    function arcPointToAngle(
        [x, y]: [number, number],
        [centerX, centerY]: [number, number],
        radius: number,
        startAngle?: number,
    ): number {
        let angle = Math.acos((x - centerX) / radius);
        // Note that the solution is not unique (e.g. points (3,2) and (3,-2) have same x and thus the same solution).
        // Also due to the symmetry of cos, multiple angles have the same cos value and thus acos is not unique.
        // We have to interpret the angles dependent on the quadrant.
        // Note that the y axis grows from top to bottom and the angles grow counter clockwise.
        if (centerY - y > 0) {
            // bottom
            angle = -angle;
        }
        if (startAngle) {
            // relative to start angle
            angle -= startAngle;
            if (angle < 0) { // this can occur where the angle switches from 180 to -180
                angle += 2 * Math.PI;
            }
        }
        return angle;
    }

    // compute arcs
    const arcs: Arc[] = [];
    for (let i = 0; i < 6; ++i) {
        const j = (i + 1) % 6;
        const center: [number, number] = [
            virtualCorners[j][0] - relativeCornerArcOffset * (virtualCorners[j][0] - centerX),
            virtualCorners[j][1] - relativeCornerArcOffset * (virtualCorners[j][1] - centerY),
        ];

        const startAngle = arcPointToAngle(lines[i].end, center, borderRadius);
        const endAngle = arcPointToAngle(lines[j].start, center, borderRadius);
        arcs.push({ center, startAngle, endAngle });
    }

    // render lines and arcs
    // draw the path
    context.save();
    context.beginPath();
    for (let i = 0; i < 6; ++i) {
        // draw line
        const line = lines[i];
        if (i === 0) {
            context.moveTo(line.start[0], line.start[1]);
        }
        context.lineTo(line.end[0], line.end[1]);

        // draw arc
        const arc = arcs[i];
        context.arc(arc.center[0], arc.center[1], borderRadius, arc.startAngle, arc.endAngle, true);
    }
    if (RENDER_OUTLINE_ONLY) {
        context.strokeStyle = '#eaeaea';
        context.lineWidth = 5;
        context.stroke();
    } else {
        const gradientFill = context.createRadialGradient(
            virtualCorners[0][0], virtualCorners[0][1], 0,
            virtualCorners[0][0], virtualCorners[0][1], 2 * radius,
        );
        gradientFill.addColorStop(0, '#ec991cff');
        gradientFill.addColorStop(1, '#e9b213ff');
        context.fillStyle = gradientFill;
        context.fill();
    }
    context.restore();
}

/**
 * Renders the front side of a coin with QR code and text
 * @param centerX - X coordinate of coin center
 * @param centerY - Y coordinate of coin center
 * @param cashlink - Cashlink object containing value and other details
 * @param link - URL or short link to encode in QR code
 * @param canvas - Canvas to render on
 * @param context - Canvas rendering context
 */
function drawFront(
    centerX: number,
    centerY: number,
    cashlink: Cashlink,
    link: string,
    canvas: Canvas,
    context: CanvasRenderingContext2D,
): void {
    drawHexagon(centerX, centerY, HEXAGON_RADIUS, BORDER_RADIUS, context);

    QrCode.render({
        size: QR_SIZE,
        left: centerX - QR_SIZE / 2,
        top: centerY - QR_SIZE / 2 + HEADER_FONT_SIZE / 5,
        text: link,
        fill: '#1F2348',
    }, canvas);

    context.fillStyle = '#1F2348';
    // render header
    const header = `${cashlink.value / 1e5} NIM`;
    context.font = `${HEADER_FONT_SIZE}px Muli-SemiBold`;
    const headerWidth = context.measureText(header).width;
    context.fillText(header, centerX - headerWidth / 2, centerY - QR_SIZE / 2 - .5 * HEADER_FONT_SIZE);
    // render link
    const simplifiedLink = link.replace(/^http(s)?:\/\//, '');
    if (simplifiedLink.length > 20) return; // only render short links
    context.font = `${LINK_FONT_SIZE}px "Fira Mono"`;
    const linkWidth = context.measureText(simplifiedLink).width;
    context.fillText(simplifiedLink, centerX - linkWidth / 2, centerY + QR_SIZE / 2 + 2.2 * LINK_FONT_SIZE);
}

/**
 * Renders the back side of a coin with Nimiq logo
 * @param centerX - X coordinate of coin center
 * @param centerY - Y coordinate of coin center
 * @param size - Size of the logo
 * @param context - Canvas rendering context
 */
function drawBack(
    centerX: number,
    centerY: number,
    size: number,
    context: CanvasRenderingContext2D,
): void {
    // drawHexagon(centerX, centerY, HEXAGON_RADIUS, BORDER_RADIUS, context);

    const logoBaseWidth = 38;
    const logoBaseHeight = 88;
    const logoBasePath = 'M22.5 10H21.5V2.5C21.5 1.12 20.38 0 19 0C17.62 0 16.5 1.12 16.5 2.5V10H15.5C6.95 10 0 16.95 0 25.5V38.5C0 47.05 6.95 54 15.5 54H19.5C20.88 54 22 52.88 22 51.5C22 50.12 20.88 49 19.5 49H15.5C9.71 49 5 44.29 5 38.5V25.5C5 19.71 9.71 15 15.5 15H22.5C28.29 15 33 19.71 33 25.5V26.4C33 27.78 34.12 28.9 35.5 28.9C36.88 28.9 38 27.78 38 26.4V25.5C38 16.95 31.05 10 22.5 10Z M22.5 34H18.5C17.12 34 16 35.12 16 36.5C16 37.88 17.12 39 18.5 39H22.5C28.29 39 33 43.71 33 49.5V62.5C33 68.29 28.29 73 22.5 73H15.5C9.71 73 5 68.29 5 62.5V61.4C5 60.02 3.88 58.9 2.5 58.9C1.12 58.9 0 60.02 0 61.4V62.5C0 71.05 6.95 78 15.5 78H16.5V85.5C16.5 86.88 17.62 88 19 88C20.38 88 21.5 86.88 21.5 85.5V78H22.5C31.05 78 38 71.05 38 62.5V49.5C38 40.95 31.05 34 22.5 34Z M0 0H1V1Z';

    const scale = size / logoBaseHeight;
    const dX = centerX - (scale * logoBaseWidth / 2);
    const dY = centerY - (scale * logoBaseHeight / 2);

    function transformX(x: string): number {
        return parseFloat(x) * scale + dX;
    }

    function transformY(y: string): number {
        return parseFloat(y) * scale + dY;
    }

    // manually render path, see https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Paths for commands
    context.save();
    context.beginPath();

    const regex = new RegExp(
        'M([0-9.]+) ([0-9.]+)|' +
        'H([0-9.]+)|' +
        'V([0-9.]+)|' +
        'C([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+)',
        'g',
    );
    let matchResult;
    let position: [number, number] = [0, 0];
    while ((matchResult = regex.exec(logoBasePath)) !== null) {
        let [match, ...params] = matchResult;
        params = params.filter((param) => param !== undefined);
        switch (match[0]) {
            case 'M':
                position = [transformX(params[0]), transformY(params[1])];
                context.moveTo(position[0], position[1]);
                break;
            case 'H':
                position[0] = transformX(params[0]);
                context.lineTo(position[0], position[1]);
                break;
            case 'V':
                position[1] = transformY(params[0]);
                context.lineTo(position[0], position[1]);
                break;
            case 'C':
                position = [transformX(params[4]), transformY(params[5])];
                context.bezierCurveTo(transformX(params[0]), transformY(params[1]), transformX(params[2]),
                    transformY(params[3]), position[0], position[1]);
                break;
            default:
                throw new Error(`Unimplemented path command ${match[0]}`);
        }
    }

    context.fillStyle = '#1F2348';
    context.fill();
    context.restore();
}

/**
 * Main function for rendering coins
 * Creates SVG files for both front and back sides of coins
 * @param cashlinks - Map of cashlink tokens to Cashlink objects
 * @param shortLinks - Optional map of short links
 * @param folder - Output folder for generated files
 * @param side - Which sides to render ('both', 'front', or 'back')
 * @returns Map of token to generated image filenames
 */
export default function renderCoins(
    cashlinks: Map<string, Cashlink>,
    shortLinks: Map<string, string> | null,
    folder: string,
    side: 'both' | 'front' | 'back' = 'both',
): Map<string, string> {
    if (side === 'both') {
        renderCoins(cashlinks, shortLinks, folder, 'back');
        return renderCoins(cashlinks, shortLinks, folder, 'front');
    }

    const filenames = new Map<string, string>();
    let { canvas, context } = initCanvas();

    const hexagonHeight = calculateHexHeight(HEXAGON_RADIUS);
    const stepX = RENDER_COMPACT ? 3 * HEXAGON_RADIUS + HEXAGON_MARGIN : 2 * HEXAGON_RADIUS + HEXAGON_MARGIN;
    const stepY = RENDER_COMPACT ? hexagonHeight / 2 + HEXAGON_MARGIN : hexagonHeight + HEXAGON_MARGIN;
    let centerX = CANVAS_WIDTH;
    let centerY = CANVAS_HEIGHT;
    let isEvenRow = false;
    let page = -1;

    // if rendered in non-compact format, we can easily center exactly, for non-compact representation this is
    // not implemented currently
    let pageMarginX, pageMarginY;
    if (RENDER_COMPACT) {
        pageMarginX = 100;
        pageMarginY = 100;
    } else {
        const hexagonsPerRow = Math.floor(CANVAS_WIDTH / (2 * HEXAGON_RADIUS + HEXAGON_MARGIN));
        const hexagonsPerColumn = Math.floor(CANVAS_HEIGHT / (hexagonHeight + HEXAGON_MARGIN));
        const renderWidth = hexagonsPerRow * (2 * HEXAGON_RADIUS)
            + Math.max(0, hexagonsPerRow - 1) * HEXAGON_MARGIN;
        const renderHeight = hexagonsPerColumn * hexagonHeight + Math.max(0, hexagonsPerColumn - 1) * HEXAGON_MARGIN;
        pageMarginX = (CANVAS_WIDTH - renderWidth) / 2;
        pageMarginY = (CANVAS_HEIGHT - renderHeight) / 2;
    }

    for (const token of cashlinks.keys()) {
        centerX += stepX;
        if (centerX > CANVAS_WIDTH - pageMarginX - HEXAGON_RADIUS) {
            // advance one row
            centerY += stepY;
            if (centerY > CANVAS_HEIGHT - pageMarginY - hexagonHeight / 2) {
                // start a new page
                if (page >= 0) {
                    if (side === 'back') break; // for back side no need to render multiple pages
                    fs.writeFileSync(`${folder || '.'}/cashcoins_${page}.svg`, canvas.toBuffer());
                    // for some reason can't just clear and reuse the old canvas after calling toBuffer (subsequent
                    // calls of toBuffer will always return the same image), therefore we create a new one
                    ({ canvas, context } = initCanvas());
                }
                page += 1;
                centerY = pageMarginY + hexagonHeight / 2;
                isEvenRow = true;
            } else {
                isEvenRow = !isEvenRow;
            }
            centerX = pageMarginX + (!RENDER_COMPACT || isEvenRow ? HEXAGON_RADIUS : HEXAGON_RADIUS * 2.5);
        }

        if (side === 'front') {
            const cashlink = cashlinks.get(token);
            if (!cashlink) {
                throw new Error(`Cashlink not found for token: ${token}`);
            }
            const link = shortLinks ? shortLinks.get(token) : cashlink.render();
            if (!link) {
                throw new Error(`Link not found for token: ${token}`);
            }
            drawFront(centerX, centerY, cashlink, link, canvas, context);
            filenames.set(token, `cashcoins_${page}.svg`);
        } else {
            drawBack(centerX, centerY, BACK_LOGO_SIZE, context);
            filenames.set(token, `cashcoins_back.svg`);
        }
    }

    // save last page or single back page
    if (side === 'front') {
        fs.writeFileSync(`${folder || '.'}/cashcoins_${page}.svg`, canvas.toBuffer());
    } else {
        fs.writeFileSync(`${folder || '.'}/cashcoins_back.svg`, canvas.toBuffer());
    }
    return filenames;
}

