// Small deterministic SVG generators for executive-report decoration.
// Keeping this logic local avoids pulling native-canvas and unmaintained pattern
// packages into the production dependency tree. Seeds affect geometry only and
// are never copied into the generated markup.

const COVER_COLORS = ["#020e1c", "#03152b", "#062a48", "#073257", "#0a3a5f"];
const SAFE_HEX_COLOR = /^#[0-9a-f]{6}$/i;

function hashSeed(seed: string): number {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash) ^ seed.charCodeAt(index);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A deterministic, full-bleed low-poly mesh for the executive cover. */
export function coverMeshSvg(seed: string): string {
  const random = createSeededRandom(seed);
  const width = 960;
  const height = 540;
  const cellWidth = 160;
  const cellHeight = 135;
  const polygons: string[] = [];

  for (let row = 0; row < height / cellHeight; row += 1) {
    for (let column = 0; column < width / cellWidth; column += 1) {
      const x = column * cellWidth;
      const y = row * cellHeight;
      const offsetX = Math.round((random() - 0.5) * 44);
      const offsetY = Math.round((random() - 0.5) * 36);
      const centerX = x + cellWidth / 2 + offsetX;
      const centerY = y + cellHeight / 2 + offsetY;
      const colorA = COVER_COLORS[Math.floor(random() * COVER_COLORS.length)];
      const colorB = COVER_COLORS[Math.floor(random() * COVER_COLORS.length)];
      polygons.push(
        `<path d="M${x} ${y}H${x + cellWidth}L${centerX} ${centerY}Z" fill="${colorA}"/>`,
        `<path d="M${x + cellWidth} ${y}V${y + cellHeight}L${centerX} ${centerY}Z" fill="${colorB}"/>`,
        `<path d="M${x + cellWidth} ${y + cellHeight}H${x}L${centerX} ${centerY}Z" fill="${colorA}"/>`,
        `<path d="M${x} ${y + cellHeight}V${y}L${centerX} ${centerY}Z" fill="${colorB}"/>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${polygons.join("")}</svg>`;
}

/** A deterministic geometric separator pattern using a caller-supplied safe color. */
export function dividerPatternSvg(seed: string, colorHex: string): string {
  const random = createSeededRandom(seed);
  const color = SAFE_HEX_COLOR.test(colorHex) ? colorHex : "#0a3a5f";
  const shapes: string[] = [];

  for (let index = 0; index < 18; index += 1) {
    const x = Math.round(random() * 320);
    const y = Math.round(random() * 180);
    const size = 8 + Math.round(random() * 24);
    const rotation = Math.round(random() * 90);
    shapes.push(
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" transform="rotate(${rotation} ${x + size / 2} ${y + size / 2})" fill="${color}" fill-opacity="0.22"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">${shapes.join("")}</svg>`;
}
