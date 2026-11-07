/** Slide units (Global Constraints): 144 px per inch, 6350 EMU per px, font size pt = px x 0.5. */
export const EMU_PER_PX = 6350;
export const PX_PER_INCH = 144;

/** Whole EMU for a px length. */
export const emu = (px: number): number => Math.round(px * EMU_PER_PX);
export const ptFromPx = (px: number): number => px * 0.5;
export const inFromPx = (px: number): number => px / PX_PER_INCH;
