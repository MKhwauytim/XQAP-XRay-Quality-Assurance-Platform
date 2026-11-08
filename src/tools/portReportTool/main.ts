// «أداة تقرير المنفذ»: one self-contained HTML page. Drop the raw report
// workbook in, pick the port, the years and the last month, and download the
// port business report as HTML, PDF (through the browser's print), PowerPoint
// and Excel, or all of them in one zip. Nothing leaves the computer: the
// workbook is read in this page only.

import JSZip from "jszip";
import { buildPortReport, listPortsInData, monthRange, portReportSheets, portReportWorkbookBytes } from "../../data/reporting/portReport/portReportBuild";
import type { PortReportBuild, PortReportData } from "../../data/reporting/portReport/portReportBuild";
import { deckHtmlToPptx } from "../../data/reporting/executive/pptx/exportDeckPptx";
import { downloadBlob } from "../../utils/downloadFile";
import ReadWorker from "./readWorkbook.worker?worker&inline";
import type { WorkerMessage } from "./readWorkbook.worker";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("file");
const drop = $<HTMLLabelElement>("drop");
const progress = $<HTMLDivElement>("progress");
const progressBar = $<HTMLDivElement>("progress-bar");
const progressText = $<HTMLParagraphElement>("progress-text");
const options = $<HTMLElement>("options");
const portSelect = $<HTMLSelectElement>("port");
const nameInput = $<HTMLInputElement>("name");
const yearsBox = $<HTMLDivElement>("years");
const lastMonthSelect = $<HTMLSelectElement>("last-month");
const periodInput = $<HTMLInputElement>("period");
const status = $<HTMLParagraphElement>("status");
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-out]"));

let data: PortReportData | null = null;

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const monthLabel = (ym: string) => `${MONTHS_AR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function setStatus(text: string, kind: "info" | "error" | "ok" = "info"): void {
  status.textContent = text;
  status.dataset.kind = kind;
}

function setBusy(busy: boolean): void {
  for (const b of buttons) b.disabled = busy || !data;
}

function selectedYears(): string[] {
  return Array.from(yearsBox.querySelectorAll<HTMLInputElement>("input:checked")).map((i) => i.value);
}

/** «من 1 يناير 2024 إلى 30 سبتمبر 2026» for the chosen years and last month. */
function periodText(): string {
  const years = selectedYears().sort();
  const last = lastMonthSelect.value;
  if (!years.length || !last) return "";
  const lastDay = new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0).getDate();
  return `من 1 يناير ${years[0]} إلى ${lastDay} ${monthLabel(last)}`;
}

function refreshPeriod(): void {
  if (!periodInput.dataset.edited) periodInput.value = periodText();
}

function showOptions(d: PortReportData): void {
  const ports = listPortsInData(d);
  portSelect.innerHTML = ports.map((p) => `<option value="${escAttr(p)}">${escAttr(p)}</option>`).join("");
  const jeddah = ports.find((p) => /جد[ةه]/.test(p));
  if (jeddah) portSelect.value = jeddah;
  nameInput.value = "";
  nameInput.placeholder = portSelect.value;
  const range = monthRange(d);
  const months: string[] = [];
  if (range) {
    let y = Number(range.first.slice(0, 4));
    let m = Number(range.first.slice(5, 7));
    for (let key = range.first; key <= range.last; key = `${y}-${String(m).padStart(2, "0")}`) {
      months.push(key);
      if (m === 12) { y++; m = 1; } else m++;
    }
  }
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  // 2024 is left out by default (the owner removed it from the report); tick it to include it.
  yearsBox.innerHTML = years.map((y) => `<label class="chip"><input type="checkbox" value="${y}"${y === "2024" && years.length > 1 ? "" : " checked"}> ${y}</label>`).join("");
  lastMonthSelect.innerHTML = months.slice().reverse().map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  periodInput.dataset.edited = "";
  refreshPeriod();
  options.hidden = false;
}

function readFile(file: File): void {
  data = null;
  setBusy(true);
  options.hidden = true;
  progress.hidden = false;
  progressBar.style.width = "0%";
  progressText.textContent = `جارٍ قراءة «${file.name}»…`;
  setStatus("");
  const worker = new ReadWorker();
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === "progress") {
      progressBar.style.width = `${m.total ? Math.round((m.done / m.total) * 100) : 0}%`;
      progressText.textContent = m.stage;
      return;
    }
    worker.terminate();
    if (m.type === "error") {
      progress.hidden = true;
      setStatus(`تعذرت قراءة الملف: ${m.message}`, "error");
      return;
    }
    data = { studyRows: m.read.studyRows, workloadMonths: m.read.workload.months };
    progressBar.style.width = "100%";
    progressText.textContent = `تمت قراءة الملف: ${m.read.studyRows.length.toLocaleString("en")} صف في «نتائج الدراسة»، و${m.read.workload.sheets.length} أوراق للمجتمع.`;
    showOptions(data);
    setBusy(false);
  };
  worker.onerror = (e) => {
    worker.terminate();
    progress.hidden = true;
    setStatus(`تعذرت قراءة الملف: ${e.message || "نفدت ذاكرة المتصفح"}`, "error");
  };
  worker.postMessage({ file });
}

function build(): PortReportBuild {
  if (!data) throw new Error("لم يُقرأ ملف بعد");
  const allYears = Array.from(yearsBox.querySelectorAll<HTMLInputElement>("input")).map((i) => i.value);
  const chosen = new Set(selectedYears());
  if (!chosen.size) throw new Error("اختر سنة واحدة على الأقل");
  return buildPortReport(data, {
    port: portSelect.value,
    displayName: nameInput.value.trim() || undefined,
    period: periodInput.value.trim() || periodText(),
    lastMonth: lastMonthSelect.value || undefined,
    excludeYears: allYears.filter((y) => !chosen.has(y)),
  });
}

function baseName(r: PortReportBuild): string {
  const without = Array.from(yearsBox.querySelectorAll<HTMLInputElement>("input:not(:checked)")).map((i) => i.value);
  return `تقرير أعمال ${r.model.displayName}${without.length ? ` - بدون ${without.join(" و")}` : ""}`;
}

/** Opens the report in a new tab and starts the print dialog there; «حفظ كملف PDF» saves it with the Somar font. */
function printPdf(r: PortReportBuild): void {
  const url = URL.createObjectURL(new Blob([r.html], { type: "text/html;charset=utf-8" }));
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error("المتصفح منع فتح نافذة جديدة؛ اسمح بالنوافذ المنبثقة لهذه الصفحة");
  }
  win.addEventListener("load", () => {
    void win.document.fonts.ready.then(() => setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 500));
  });
}

async function run(out: string): Promise<void> {
  setBusy(true);
  try {
    setStatus("جارٍ إعداد التقرير…");
    const r = build();
    const name = baseName(r);
    const xlsx = async () => new Blob([(await portReportWorkbookBytes(portReportSheets(r))) as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (out === "html") downloadBlob(new Blob([r.html], { type: "text/html;charset=utf-8" }), `${name}.html`);
    else if (out === "xlsx") downloadBlob(await xlsx(), `${name}.xlsx`);
    else if (out === "pdf") printPdf(r);
    else if (out === "pptx") {
      setStatus("جارٍ إعداد ملف PowerPoint…");
      downloadBlob((await deckHtmlToPptx(r.html, name)).blob, `${name}.pptx`);
    } else if (out === "zip") {
      setStatus("جارٍ إعداد الملف المضغوط…");
      const zip = new JSZip();
      zip.file(`${name}.html`, r.html);
      zip.file(`${name}.xlsx`, await xlsx());
      zip.file(`${name}.pptx`, (await deckHtmlToPptx(r.html, name)).blob);
      downloadBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `${name}.zip`);
    }
    setStatus(out === "pdf" ? "فُتح التقرير في نافذة جديدة: اختر «حفظ كملف PDF» في نافذة الطباعة." : `تم تنزيل «${name}».`, "ok");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "error");
  } finally {
    setBusy(false);
  }
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) readFile(f);
});
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) readFile(f);
});
portSelect.addEventListener("change", () => { nameInput.placeholder = portSelect.value; });
yearsBox.addEventListener("change", refreshPeriod);
lastMonthSelect.addEventListener("change", refreshPeriod);
periodInput.addEventListener("input", () => { periodInput.dataset.edited = "1"; });
for (const b of buttons) b.addEventListener("click", () => { void run(b.dataset.out ?? ""); });
setBusy(false);
