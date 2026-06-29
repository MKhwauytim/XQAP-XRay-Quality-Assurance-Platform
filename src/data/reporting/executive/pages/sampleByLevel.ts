import type { ExecutiveRenderContext } from "../context";
import { dataTable, kpiCard, fmtNum, fmtPct, esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header"><div class="xr-org-text">${lines}</div><div class="xr-org-logo">🛡</div></div>`;
}

export function buildSampleByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis, input } = ctx;
  const s = input.sample;

  const kpis4 = [
    kpiCard({ label: "حجم العينة الكلي", value: fmtNum(kpis.totalSample), tone: "accent" }),
    kpiCard({ label: "CertScan", value: s ? fmtNum(s.certScanActual) : "—" }),
    kpiCard({ label: "نسبة التغطية", value: fmtPct(kpis.sampleCoverage), tone: "good" }),
    kpiCard({ label: "المجتمع الكلي", value: fmtNum(kpis.totalPopulation) }),
  ].join("");

  const stageRows = kpis.stageProfiles.map(sp => [
    esc(sp.stageLabel),
    fmtNum(sp.population),
    fmtNum(sp.sampleSize),
    fmtPct(sp.coverage),
    fmtNum(sp.studied),
  ]);

  const portRows = kpis.portProfiles.map(p => [
    esc(p.portName),
    fmtNum(p.population),
    fmtNum(p.sampleSize),
    fmtPct(p.coverage),
    fmtNum(p.studied),
    fmtPct(p.completionRate),
  ]);

  return `<section class="xr-page" id="page-sample">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">مستويات الدراسة والعينة حسب المنافذ</h2>
      <div class="xr-kpi-grid xr-kpi-grid-4">${kpis4}</div>
      <div class="xr-cols xr-cols-2">
        <div>
          <div class="xr-panel-title">العينة حسب المستوى</div>
          ${dataTable({ headers: ["المستوى","المجتمع","العينة","التغطية","مدروسة"], rows: stageRows })}
        </div>
        <div>
          <div class="xr-panel-title">العينة حسب المنفذ</div>
          ${dataTable({ headers: ["المنفذ","المجتمع","العينة","التغطية","مدروسة","الإنجاز"], rows: portRows })}
        </div>
      </div>
      <div class="xr-page-num">• 12 •</div>
    </div>
  </section>`;
}
