/** Text width measurement. The host injects a canvas measurer (Milestone 3); tests use the fixed-advance one. */
export interface TextMeasurer {
  width(text: string, sizePx: number, weight: 400 | 700): number;
}

/** Measured widths are multiplied by this before any fit decision (PoC: browser widths ran short). */
export const FIT_SAFETY = 1.04;

const BOLD_FACTOR = 1.06;
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const SPACE = /\s/;

/** Deterministic measurer: each character advances a fixed fraction of the font size. */
export function createFixedAdvanceMeasurer(
  advance: { arabic: number; latin: number; space: number } = { arabic: 0.5, latin: 0.55, space: 0.25 },
): TextMeasurer {
  return {
    width(text, sizePx, weight) {
      let units = 0;
      for (const ch of text) {
        units += SPACE.test(ch) ? advance.space : ARABIC.test(ch) ? advance.arabic : advance.latin;
      }
      return units * sizePx * (weight === 700 ? BOLD_FACTOR : 1);
    },
  };
}
