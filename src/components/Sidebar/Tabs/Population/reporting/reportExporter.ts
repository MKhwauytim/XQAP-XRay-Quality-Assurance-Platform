import { buildPopulationReportData } from "./reportDataBuilder";
import { buildPopulationReportHtml } from "./reportHtmlBuilder";
import type { BuildPopulationReportInput } from "./reportTypes";

function downloadHtml(html: string): void {
  const blob = new Blob([html], {
    type: "text/html;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "تقرير_معالجة_المجتمع.html";

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

function openReportWindow(html: string): Window | null {
  const reportWindow = window.open("", "_blank");

  if (!reportWindow) {
    return null;
  }

  try {
    reportWindow.opener = null;
    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();

    reportWindow.addEventListener("load", () => {
      try {
        reportWindow.focus();
      } catch {
        // Ignore focus errors.
      }
    });

    return reportWindow;
  } catch {
    try {
      reportWindow.close();
    } catch {
      // Ignore close errors.
    }

    return null;
  }
}

export function exportPopulationReport(input: BuildPopulationReportInput): void {
  const reportData = buildPopulationReportData(input);
  const html = buildPopulationReportHtml(reportData);
  const reportWindow = openReportWindow(html);

  if (!reportWindow) {
    downloadHtml(html);
  }
}