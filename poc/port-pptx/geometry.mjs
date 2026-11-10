// T2 step 2: lay out out/report.html in headless Edge and dump every slide's boxes.
//
// Writes out/geometry.json: per slide, in 1920x1080 slide px,
//   shapes  (filled boxes and border rules), texts (one box per block, with styled runs),
//   tables  (cells with runs, fills, rules; column widths; row heights),
//   charts  (deck3 CSS bar charts: bars, values, tones, categories, ref lines),
//   svgs    (the timeline svg box and its year labels), images (the logo),
//   allText (every visible text node, used only by parity.mjs as the HTML side).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

// Runs in the page. Kept as a plain function so it can be stringified.
function probe() {
  const px = (v) => parseFloat(v) || 0;
  const visible = (el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0; };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(",").map((x) => x.trim()); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const isBlock = (el) => { const d = getComputedStyle(el).display; return !(d === "inline" || d === "contents"); };
  const slides = [];
  for (const sl of document.querySelectorAll("section.slide.v3")) {
    const R = sl.getBoundingClientRect();
    const k = R.width / 1920;
    const box = (r) => ({ x: (r.left - R.left) / k, y: (r.top - R.top) / k, w: r.width / k, h: r.height / k });
    const out = { id: sl.id, cls: sl.className, bg: getComputedStyle(sl).backgroundColor, shapes: [], texts: [], tables: [], charts: [], svgs: [], images: [], allText: [] };
    const styleOf = (el) => { const s = getComputedStyle(el); return { color: s.color, size: px(s.fontSize), bold: parseInt(s.fontWeight, 10) >= 600, weight: parseInt(s.fontWeight, 10) || 400, lh: s.lineHeight === "normal" ? px(s.fontSize) * 1.3 : px(s.lineHeight) }; };
    // Runs of one block: its text nodes in order, <br> as a break; nested blocks are skipped (they are their own block).
    const runsOf = (block) => {
      const runs = [];
      const rects = [];
      // Where the browser wrapped: each word's rect; a word whose middle is below the previous
      // word's bottom starts a new visual line, recorded as a soft break {br:"soft"}.
      let prevBottom = null;
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) {
            const raw = c.textContent;
            const t = raw.replace(/\s+/g, " ");
            if (!t.trim()) { if (runs.length && t) runs.push({ text: " ", ...styleOf(n) }); continue; }
            const rg = document.createRange(); rg.selectNodeContents(c);
            for (const r of rg.getClientRects()) if (r.width > 0) rects.push(r);
            let piece = "", last = 0;
            for (const m of raw.matchAll(/\S+/g)) {
              const wr = document.createRange(); wr.setStart(c, m.index); wr.setEnd(c, m.index + m[0].length);
              const r = wr.getBoundingClientRect();
              const gap = raw.slice(last, m.index).replace(/\s+/g, " ");
              if (prevBottom !== null && r.height > 0 && (r.top + r.bottom) / 2 > prevBottom) {
                if (piece.trim()) runs.push({ text: piece.replace(/\s+$/, ""), ...styleOf(n) });
                runs.push({ br: "soft" });
                piece = m[0];
              } else piece += gap + m[0];
              if (r.height > 0) prevBottom = prevBottom === null || (r.top + r.bottom) / 2 > prevBottom ? r.bottom : Math.max(prevBottom, r.bottom);
              last = m.index + m[0].length;
            }
            piece += raw.slice(last).replace(/\s+/g, " ");
            if (piece) runs.push({ text: piece, ...styleOf(n) });
          } else if (c.nodeType === 1) {
            if (c.tagName === "BR") { runs.push({ br: true }); prevBottom = null; continue; }
            if (!visible(c)) continue;
            if (isBlock(c) && getComputedStyle(c).display !== "inline-block") continue;
            walk(c);
          }
        }
      };
      walk(block);
      while (runs.length && (runs[0].br || runs[0].text === " ")) runs.shift();
      while (runs.length && (runs[runs.length - 1].br || runs[runs.length - 1].text === " ")) runs.pop();
      if (runs[0]) runs[0].text = runs[0].text.trimStart();
      if (runs.length) runs[runs.length - 1].text = (runs[runs.length - 1].text || "").trimEnd();
      if (!rects.length) return null;
      const u = rects.reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }), { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 });
      // Lines: a rect whose vertical middle is below the current line's bottom starts a new line.
      let lines = 0, lineBottom = -1e9;
      for (const r of [...rects].sort((a, b) => a.top - b.top)) { if ((r.top + r.bottom) / 2 > lineBottom) { lines++; lineBottom = r.bottom; } else lineBottom = Math.max(lineBottom, r.bottom); }
      // Content box of the block: the width the browser wrapped at.
      const bs = getComputedStyle(block), br = block.getBoundingClientRect();
      const content = box({ left: br.left + px(bs.paddingLeft) + px(bs.borderLeftWidth), top: br.top + px(bs.paddingTop), width: br.width - px(bs.paddingLeft) - px(bs.paddingRight) - px(bs.borderLeftWidth) - px(bs.borderRightWidth), height: br.height });
      const text = runs.map((x) => (x.br ? "\n" : x.text)).join("");
      return { runs, rect: box({ left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top }), lines, content, text, align: bs.textAlign };
    };
    const decorate = (el, list) => {
      if (el === sl) return;
      const s = getComputedStyle(el);
      const b = box(el.getBoundingClientRect());
      if (b.w < 0.5 || b.h < 0.5) { if (!(px(s.borderTopWidth) > 0)) return; }
      if (alpha(s.backgroundColor) > 0) list.push({ kind: "rect", ...b, fill: s.backgroundColor, radius: px(s.borderTopLeftRadius) });
      for (const side of ["Top", "Bottom", "Left", "Right"]) {
        const w = px(s[`border${side}Width`]);
        if (w <= 0 || s[`border${side}Style`] === "none" || alpha(s[`border${side}Color`]) === 0) continue;
        const line = side === "Top" ? { x: b.x, y: b.y, w: b.w, h: w } : side === "Bottom" ? { x: b.x, y: b.y + b.h - w, w: b.w, h: w } : side === "Left" ? { x: b.x, y: b.y, w, h: b.h } : { x: b.x + b.w - w, y: b.y, w, h: b.h };
        list.push({ kind: "line", ...line, color: s[`border${side}Color`], dash: s[`border${side}Style`] });
      }
    };
    const consumed = new Set();
    const visit = (el) => {
      if (!visible(el) || consumed.has(el)) return;
      if (el.classList.contains("slide-controls")) return;
      const tag = el.tagName;
      if (tag === "IMG") {
        const b = box(el.getBoundingClientRect());
        const f = getComputedStyle(el).filter;
        if (f && f !== "none") {
          // Bake the CSS filter into the pixels so PowerPoint shows what the HTML shows.
          const c = document.createElement("canvas");
          c.width = Math.round(b.w * 3); c.height = Math.round(b.h * 3);
          const ctx = c.getContext("2d");
          ctx.filter = f;
          ctx.drawImage(el, 0, 0, c.width, c.height);
          out.images.push({ ...b, src: c.toDataURL("image/png"), png: true });
        } else out.images.push({ ...b, src: el.src });
        return;
      }
      if ((tag === "svg" || tag === "SVG") && (el.hasAttribute("data-pptx-image") || /إرساليات/.test(el.getAttribute("aria-label") ?? ""))) {
        // The monthly counts chart has no native PowerPoint rebuild: it goes in as an svg image,
        // with the theme colours and the font resolved (an image cannot read the page's CSS variables).
        const b = box(el.getBoundingClientRect());
        const clone = el.cloneNode(true);
        const src = [el, ...el.querySelectorAll("*")];
        const dst = [clone, ...clone.querySelectorAll("*")];
        src.forEach((n, i) => {
          const cs = getComputedStyle(n);
          for (const a of ["fill", "stroke"]) if ((n.getAttribute(a) ?? "").includes("var(")) dst[i].setAttribute(a, cs[a]);
        });
        const vb = el.viewBox.baseVal;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(vb.width));
        clone.setAttribute("height", String(vb.height));
        clone.setAttribute("font-family", getComputedStyle(el).fontFamily);
        clone.removeAttribute("style");
        const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        for (const [k2, v2] of [["x", "0"], ["y", "0"], ["width", String(vb.width)], ["height", String(vb.height)], ["fill", getComputedStyle(el).backgroundColor]]) bgRect.setAttribute(k2, v2);
        clone.insertBefore(bgRect, clone.firstChild);
        out.images.push({ ...b, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}` });
        return;
      }
      if (tag === "svg" || tag === "SVG") {
        const b = box(el.getBoundingClientRect());
        const texts = [...el.querySelectorAll("text")].map((t) => ({ text: t.textContent, size: px(t.getAttribute("font-size")), bold: t.getAttribute("font-weight") === "700", fill: t.getAttribute("fill"), ...box(t.getBoundingClientRect()) }));
        out.svgs.push({ ...b, texts });
        return;
      }
      if (tag === "TABLE") {
        const t = { ...box(el.getBoundingClientRect()), rows: [] };
        for (const tr of el.querySelectorAll("tr")) {
          if (!visible(tr)) continue;
          const row = { ...box(tr.getBoundingClientRect()), head: !!tr.closest("thead"), foot: !!tr.closest("tfoot"), cells: [] };
          for (const td of tr.children) {
            const s = getComputedStyle(td);
            const r = runsOf(td);
            const bw = (side) => (s[`border${side}Style`] === "none" ? 0 : px(s[`border${side}Width`]));
            row.cells.push({ ...box(td.getBoundingClientRect()), colspan: td.colSpan || 1, runs: r ? r.runs : [], lines: r ? r.lines : 0, text: r ? r.text : "", fill: alpha(s.backgroundColor) > 0 ? s.backgroundColor : null, bt: bw("Top"), btc: s.borderTopColor, bb: bw("Bottom"), bbc: s.borderBottomColor, ...styleOf(td), padL: px(s.paddingLeft), padR: px(s.paddingRight) });
          }
          t.rows.push(row);
        }
        out.tables.push(t);
        decorate(el, out.shapes);
        return;
      }
      if (el.classList.contains("v3-plot")) {
        const cats = el.nextElementSibling && el.nextElementSibling.classList.contains("v3-cats") ? el.nextElementSibling : null;
        if (cats) consumed.add(cats);
        const barsEl = el.querySelector(".v3-bars");
        const groups = [...barsEl.children].map((g) => (g.classList.contains("v3-group") ? [...g.children] : [g]));
        const point = (cell) => {
          const bar = cell.querySelector(".v3-bar");
          if (!bar) return { value: null, label: null, color: null, hPct: null };
          const span = bar.querySelector("span");
          return { label: span ? span.textContent : null, color: getComputedStyle(bar).backgroundColor, hPct: parseFloat(bar.style.height), labelSize: span ? px(getComputedStyle(span).fontSize) : 18, labelColor: span ? getComputedStyle(span).color : null, ...box(bar.getBoundingClientRect()) };
        };
        const c = {
          ...box(el.getBoundingClientRect()),
          plotBg: getComputedStyle(el).backgroundColor,
          series: groups[0].length,
          points: groups.map((g) => g.map(point)),
          cats: cats ? [...cats.children].map((x) => ({ text: x.innerText.replace(/\n+/g, " ").trim(), ...styleOf(x) })) : [],
          catsBox: cats ? box(cats.getBoundingClientRect()) : null,
          refs: [...el.querySelectorAll(".v3-refline")].map((r) => ({ ...box(r.getBoundingClientRect()), color: getComputedStyle(r).borderTopColor, w: px(getComputedStyle(r).borderTopWidth) })),
        };
        out.charts.push(c);
        decorate(el, out.shapes);
        return;
      }
      decorate(el, out.shapes);
      const hasOwnText = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (isBlock(el) && (hasOwnText || [...el.childNodes].some((c) => c.nodeType === 1 && !isBlock(c) && c.textContent.trim()))) {
        const r = runsOf(el);
        if (r) out.texts.push(r);
      }
      // Inline children with a fill (legend swatches) are decorations too.
      for (const c of el.children) {
        if (!isBlock(c) || getComputedStyle(c).display === "inline-block") { if (visible(c)) { decorate(c, out.shapes); for (const cc of c.children) if (visible(cc)) decorate(cc, out.shapes); } }
        else visit(c);
      }
    };
    for (const c of sl.children) visit(c);
    // HTML side of the parity check: every visible text node of the slide, independent of the converter.
    const tw = document.createTreeWalker(sl, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const p = n.parentElement;
      if (!p || !n.textContent.trim() || p.closest(".slide-controls") || p.closest("script,style")) continue;
      if (!p.getClientRects().length || getComputedStyle(p).visibility === "hidden") continue;
      const svgAxis = p.tagName === "text" && p.getAttribute("text-anchor") === "start" && /%$/.test(n.textContent.trim());
      out.allText.push({ text: n.textContent, svgAxis });
    }
    slides.push(out);
  }
  return slides;
}

export function runGeometry() {
  const html = readFileSync(join(outDir, "report.html"), "utf8");
  const inject = `<style>.slide.v3{display:flex!important;transform:none!important;margin:0!important}.slide[data-print-off]{display:flex!important}</style>`;
  const script = `<script>window.addEventListener("load",()=>setTimeout(()=>{const p=document.createElement("pre");p.id="geo-out";p.textContent=JSON.stringify((${probe.toString()})());document.body.appendChild(p);},1500));</script>`;
  const file = join(outDir, "geo.html");
  writeFileSync(file, html.replace("</head>", `${inject}</head>`).replace("</body>", `${script}</body>`));
  const prof = join(outDir, ".edge-profile");
  mkdirSync(prof, { recursive: true });
  const dom = execFileSync(EDGE, ["--headless", "--disable-gpu", "--log-level=3", "--no-first-run", `--user-data-dir=${prof}`, "--allow-file-access-from-files", "--window-size=1920,1080", "--virtual-time-budget=20000", "--dump-dom", pathToFileURL(file).href], { encoding: "utf8", maxBuffer: 5e8 });
  const m = dom.match(/<pre id="geo-out">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error("geometry probe produced no output");
  const txt = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const slides = JSON.parse(txt);
  writeFileSync(join(outDir, "geometry.json"), JSON.stringify(slides));
  return slides;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = runGeometry();
  console.log(`slides ${s.length}`, s.map((x, i) => `${i + 1}:t${x.texts.length}/tb${x.tables.length}/c${x.charts.length}/s${x.svgs.length}/i${x.images.length}`).join(" "));
}
