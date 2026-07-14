// Ambient module declarations for vendored visual libraries that ship no types.
// (qrcode, geopattern, d3-shape, d3-scale all have @types packages; only
// trianglify's browser bundle needs a hand-written shim.)

declare module "trianglify/dist/trianglify.bundle.js" {
  interface TrianglifyOptions {
    width?: number;
    height?: number;
    cellSize?: number;
    variance?: number;
    seed?: string | null;
    xColors?: string[] | string;
    yColors?: string[] | string;
    colorSpace?: string;
    strokeWidth?: number;
    fill?: boolean;
  }
  interface TrianglifySvgTree {
    toString(): string;
  }
  interface TrianglifyPattern {
    toSVGTree(opts?: Record<string, unknown>): TrianglifySvgTree;
  }
  function trianglify(opts?: TrianglifyOptions): TrianglifyPattern;
  export default trianglify;
}
