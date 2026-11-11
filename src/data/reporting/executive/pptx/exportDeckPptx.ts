// Executive deck (deck3) as an editable PowerPoint file, built in the browser.
//
// The deck's HTML is laid out in a hidden 1920px-wide frame, every slide is
// measured (`deckGeometry.ts`) and rebuilt from native PowerPoint parts
// (`deckToPptx.ts`). Slides that are off by default in print are left out, so
// the file matches what the printed report shows.

import { downloadBlob } from "../../../../utils/downloadFile";
import { PRINT_DEFAULT_OFF_CLASS } from "../printSelection";
import { readDeckGeometry } from "./deckGeometry";
import { deckToPptx, type DeckPptxOptions } from "./deckToPptx";

const LAYOUT_CSS = `.slide.v3{display:flex!important;transform:none!important;margin:0!important;zoom:1!important}`;

/** Lays `html` out in a hidden frame, waits for its fonts and images, then hands the document to `read`. */
async function withLaidOutDeck<T>(html: string, read: (doc: Document) => Promise<T>): Promise<T> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1920px;height:1080px;border:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      frame.srcdoc = html.replace("</head>", `<style>${LAYOUT_CSS}</style></head>`);
    });
    const doc = frame.contentDocument;
    if (!doc) throw new Error("deck frame has no document");
    doc.querySelectorAll(`.${PRINT_DEFAULT_OFF_CLASS}`).forEach((el) => el.remove());
    await doc.fonts.ready;
    await Promise.all([...doc.images].map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = img.onerror = () => r(); }))));
    // One more frame so the layout reflects the injected stylesheet.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return await read(doc);
  } finally {
    frame.remove();
  }
}

/** The PowerPoint file for a finished deck3 HTML string. */
export async function deckHtmlToPptx(html: string, title: string, options: DeckPptxOptions = {}): Promise<{ blob: Blob; slides: number }> {
  const slides = await withLaidOutDeck(html, readDeckGeometry);
  if (!slides.length) throw new Error("deck has no slides");
  return { blob: await deckToPptx(slides, title, options), slides: slides.length };
}

/** Builds the PowerPoint file for a finished deck3 HTML string and downloads it as `fileName`. */
export async function downloadDeckAsPptx(html: string, fileName: string, title: string): Promise<{ slides: number }> {
  const { blob, slides } = await deckHtmlToPptx(html, title);
  downloadBlob(blob, fileName);
  return { slides };
}
