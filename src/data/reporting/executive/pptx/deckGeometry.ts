// Reads a laid-out deck3 document and returns each slide's boxes in 1920x1080
// slide px: filled boxes and border rules, text blocks with styled runs, tables,
// deck3 CSS bar charts, svgs (as images) and pictures. The converter in
// `deckToPptx.ts` turns this into native PowerPoint parts.
//
// Ported from the Jeddah PowerPoint trial (poc/port-pptx/geometry.mjs), which
// ran the same walk in headless Edge; here it runs on a document the app has
// already laid out in a hidden frame.

export type Run =
  | { br: true | "soft" }
  | { br?: undefined; text: string; color: string; size: number; bold: boolean; lh: number };

export type Box = { x: number; y: number; w: number; h: number };

export type TextBlock = { runs: Run[]; rect: Box; lines: number; content: Box; text: string };

export type ShapeGeo =
  | ({ kind: "rect"; fill: string; radius: number } & Box)
  | ({ kind: "line"; color: string; dash: string } & Box);

export type CellGeo = Box & {
  colspan: number; runs: Run[]; text: string; fill: string | null;
  bt: number; btc: string; bb: number; bbc: string;
  color: string; size: number; bold: boolean; padL: number; padR: number;
};

export type TableGeo = Box & { rows: (Box & { cells: CellGeo[] })[] };

export type BarPoint = (Box & { label: string | null; color: string; hPct: number; labelSize: number; labelColor: string | null }) | { label: null; color: null; hPct: null };

export type ChartGeo = Box & {
  series: number;
  points: BarPoint[][];
  cats: { text: string; size: number; color: string }[];
  catsBox: Box | null;
  refs: (Box & { color: string })[];
};

export type ImageGeo = Box & { src: string };

export type SlideGeo = {
  bg: string;
  shapes: ShapeGeo[];
  texts: TextBlock[];
  tables: TableGeo[];
  charts: ChartGeo[];
  images: ImageGeo[];
};

const px = (v: string | null | undefined): number => parseFloat(v ?? "") || 0;

function alpha(c: string): number {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return 0;
  const p = m[1].split(",").map((x) => x.trim());
  return p.length > 3 ? parseFloat(p[3]) : 1;
}

/** An svg element drawn to a PNG data URL at 2x, so charts drawn as svg keep their look. */
async function svgToPng(svg: SVGSVGElement, w: number, h: number): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("svg image failed to load"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * 2));
  canvas.height = Math.max(1, Math.round(h * 2));
  const ctx = canvas.getContext("2d");
  if (!ctx) return url;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** Every visible deck3 slide (`section.slide.v3`) of `doc`, measured. */
export async function readDeckGeometry(doc: Document): Promise<SlideGeo[]> {
  const win = doc.defaultView;
  if (!win) throw new Error("deck document has no window");
  const cs = (el: Element): CSSStyleDeclaration => win.getComputedStyle(el);
  const visible = (el: Element): boolean => {
    const s = cs(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
  };
  const isBlock = (el: Element): boolean => {
    const d = cs(el).display;
    return !(d === "inline" || d === "contents");
  };
  const slides: SlideGeo[] = [];

  for (const sl of doc.querySelectorAll("section.slide.v3")) {
    const R = sl.getBoundingClientRect();
    const k = R.width / 1920;
    const box = (r: { left: number; top: number; width: number; height: number }): Box => ({ x: (r.left - R.left) / k, y: (r.top - R.top) / k, w: r.width / k, h: r.height / k });
    const out: SlideGeo = { bg: cs(sl).backgroundColor, shapes: [], texts: [], tables: [], charts: [], images: [] };
    const svgJobs: Promise<void>[] = [];
    const styleOf = (el: Element) => {
      const s = cs(el);
      return { color: s.color, size: px(s.fontSize), bold: parseInt(s.fontWeight, 10) >= 600, lh: s.lineHeight === "normal" ? px(s.fontSize) * 1.3 : px(s.lineHeight) };
    };

    // Runs of one block: its text nodes in order, <br> as a break; nested blocks are their own block.
    // Where the browser wrapped, a word whose middle sits below the previous word starts a soft break.
    const runsOf = (block: Element): TextBlock | null => {
      const runs: Run[] = [];
      const rects: DOMRect[] = [];
      let prevBottom: number | null = null;
      const walk = (n: Element): void => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) {
            const raw = c.textContent ?? "";
            const t = raw.replace(/\s+/g, " ");
            if (!t.trim()) { if (runs.length && t) runs.push({ text: " ", ...styleOf(n) }); continue; }
            const rg = doc.createRange(); rg.selectNodeContents(c);
            for (const r of rg.getClientRects()) if (r.width > 0) rects.push(r);
            let piece = "";
            let last = 0;
            for (const m of raw.matchAll(/\S+/g)) {
              const idx = m.index ?? 0;
              const wr = doc.createRange(); wr.setStart(c, idx); wr.setEnd(c, idx + m[0].length);
              const r = wr.getBoundingClientRect();
              const gap = raw.slice(last, idx).replace(/\s+/g, " ");
              if (prevBottom !== null && r.height > 0 && (r.top + r.bottom) / 2 > prevBottom) {
                if (piece.trim()) runs.push({ text: piece.replace(/\s+$/, ""), ...styleOf(n) });
                runs.push({ br: "soft" });
                piece = m[0];
              } else piece += gap + m[0];
              if (r.height > 0) prevBottom = prevBottom === null || (r.top + r.bottom) / 2 > prevBottom ? r.bottom : Math.max(prevBottom, r.bottom);
              last = idx + m[0].length;
            }
            piece += raw.slice(last).replace(/\s+/g, " ");
            if (piece) runs.push({ text: piece, ...styleOf(n) });
          } else if (c.nodeType === 1) {
            const e = c as Element;
            if (e.tagName === "BR") { runs.push({ br: true }); prevBottom = null; continue; }
            if (!visible(e)) continue;
            if (isBlock(e) && cs(e).display !== "inline-block") continue;
            walk(e);
          }
        }
      };
      walk(block);
      const isGap = (r: Run): boolean => Boolean(r.br) || (!r.br && r.text === " ");
      while (runs.length && isGap(runs[0])) runs.shift();
      while (runs.length && isGap(runs[runs.length - 1])) runs.pop();
      const first = runs[0];
      if (first && !first.br) first.text = first.text.trimStart();
      const lastRun = runs[runs.length - 1];
      if (lastRun && !lastRun.br) lastRun.text = lastRun.text.trimEnd();
      if (!rects.length) return null;
      const u = rects.reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }), { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 });
      let lines = 0;
      let lineBottom = -1e9;
      for (const r of [...rects].sort((a, b) => a.top - b.top)) {
        if ((r.top + r.bottom) / 2 > lineBottom) { lines++; lineBottom = r.bottom; } else lineBottom = Math.max(lineBottom, r.bottom);
      }
      const bs = cs(block);
      const br = block.getBoundingClientRect();
      const content = box({ left: br.left + px(bs.paddingLeft) + px(bs.borderLeftWidth), top: br.top + px(bs.paddingTop), width: br.width - px(bs.paddingLeft) - px(bs.paddingRight) - px(bs.borderLeftWidth) - px(bs.borderRightWidth), height: br.height });
      const text = runs.map((x) => (x.br ? "\n" : x.text)).join("");
      return { runs, rect: box({ left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top }), lines, content, text };
    };

    const decorate = (el: Element, list: ShapeGeo[]): void => {
      if (el === sl) return;
      const s = cs(el);
      const b = box(el.getBoundingClientRect());
      if ((b.w < 0.5 || b.h < 0.5) && !(px(s.borderTopWidth) > 0)) return;
      if (alpha(s.backgroundColor) > 0) list.push({ kind: "rect", ...b, fill: s.backgroundColor, radius: px(s.borderTopLeftRadius) });
      for (const side of ["top", "bottom", "left", "right"] as const) {
        const w = px(s.getPropertyValue(`border-${side}-width`));
        const style = s.getPropertyValue(`border-${side}-style`);
        const color = s.getPropertyValue(`border-${side}-color`);
        if (w <= 0 || style === "none" || alpha(color) === 0) continue;
        const line = side === "top" ? { x: b.x, y: b.y, w: b.w, h: w }
          : side === "bottom" ? { x: b.x, y: b.y + b.h - w, w: b.w, h: w }
            : side === "left" ? { x: b.x, y: b.y, w, h: b.h }
              : { x: b.x + b.w - w, y: b.y, w, h: b.h };
        list.push({ kind: "line", ...line, color, dash: style });
      }
    };

    const consumed = new Set<Element>();
    const visit = (el: Element): void => {
      if (!visible(el) || consumed.has(el)) return;
      if (el.classList.contains("slide-controls")) return;
      const tag = el.tagName.toUpperCase();
      if (tag === "IMG") {
        const b = box(el.getBoundingClientRect());
        const img = el as HTMLImageElement;
        const f = cs(el).filter;
        if (f && f !== "none") {
          // Bake the CSS filter into the pixels so PowerPoint shows what the HTML shows.
          const c = doc.createElement("canvas");
          c.width = Math.round(b.w * 3); c.height = Math.round(b.h * 3);
          const ctx = c.getContext("2d");
          if (ctx) { ctx.filter = f; ctx.drawImage(img, 0, 0, c.width, c.height); out.images.push({ ...b, src: c.toDataURL("image/png") }); }
        } else out.images.push({ ...b, src: img.src });
        return;
      }
      if (tag === "SVG") {
        const b = box(el.getBoundingClientRect());
        const entry: ImageGeo = { ...b, src: "" };
        out.images.push(entry);
        const r = el.getBoundingClientRect();
        svgJobs.push(svgToPng(el as SVGSVGElement, r.width, r.height).then((src) => { entry.src = src; }, () => undefined));
        return;
      }
      if (tag === "TABLE") {
        const t: TableGeo = { ...box(el.getBoundingClientRect()), rows: [] };
        for (const tr of el.querySelectorAll("tr")) {
          if (!visible(tr)) continue;
          const row = { ...box(tr.getBoundingClientRect()), cells: [] as CellGeo[] };
          for (const td of tr.children) {
            const s = cs(td);
            const r = runsOf(td);
            const bw = (side: "top" | "bottom"): number => (s.getPropertyValue(`border-${side}-style`) === "none" ? 0 : px(s.getPropertyValue(`border-${side}-width`)));
            row.cells.push({
              ...box(td.getBoundingClientRect()), colspan: (td as HTMLTableCellElement).colSpan || 1,
              runs: r ? r.runs : [], text: r ? r.text : "",
              fill: alpha(s.backgroundColor) > 0 ? s.backgroundColor : null,
              bt: bw("top"), btc: s.borderTopColor, bb: bw("bottom"), bbc: s.borderBottomColor,
              ...styleOf(td), padL: px(s.paddingLeft), padR: px(s.paddingRight),
            });
          }
          t.rows.push(row);
        }
        out.tables.push(t);
        decorate(el, out.shapes);
        return;
      }
      if (el.classList.contains("v3-plot")) {
        const barsEl = el.querySelector(".v3-bars");
        if (barsEl) {
          const next = el.nextElementSibling;
          const cats = next && next.classList.contains("v3-cats") ? next : null;
          if (cats) consumed.add(cats);
          const groups = [...barsEl.children].map((g) => (g.classList.contains("v3-group") ? [...g.children] : [g]));
          const point = (cell: Element): BarPoint => {
            const bar = cell.querySelector<HTMLElement>(".v3-bar");
            if (!bar) return { label: null, color: null, hPct: null };
            const span = bar.querySelector("span");
            return { label: span ? span.textContent : null, color: cs(bar).backgroundColor, hPct: parseFloat(bar.style.height), labelSize: span ? px(cs(span).fontSize) : 18, labelColor: span ? cs(span).color : null, ...box(bar.getBoundingClientRect()) };
          };
          out.charts.push({
            ...box(el.getBoundingClientRect()),
            series: groups[0]?.length ?? 1,
            points: groups.map((g) => g.map(point)),
            cats: cats ? [...cats.children].map((x) => ({ text: (x as HTMLElement).innerText.replace(/\n+/g, " ").trim(), ...styleOf(x) })) : [],
            catsBox: cats ? box(cats.getBoundingClientRect()) : null,
            refs: [...el.querySelectorAll(".v3-refline")].map((r) => ({ ...box(r.getBoundingClientRect()), color: cs(r).borderTopColor })),
          });
          decorate(el, out.shapes);
          return;
        }
      }
      decorate(el, out.shapes);
      const hasOwnText = [...el.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? "").trim());
      if (isBlock(el) && (hasOwnText || [...el.childNodes].some((c) => c.nodeType === 1 && !isBlock(c as Element) && (c.textContent ?? "").trim()))) {
        const r = runsOf(el);
        if (r) out.texts.push(r);
      }
      // Inline children with a fill (legend swatches) are decorations too.
      for (const c of el.children) {
        if (!isBlock(c) || cs(c).display === "inline-block") {
          if (visible(c)) { decorate(c, out.shapes); for (const cc of c.children) if (visible(cc)) decorate(cc, out.shapes); }
        } else visit(c);
      }
    };
    for (const c of sl.children) visit(c);
    await Promise.all(svgJobs);
    out.images = out.images.filter((im) => im.src);
    slides.push(out);
  }
  return slides;
}
