import type {
  BiFillReportRow,
  PopulationReportData,
  RiskStageDistributionRow,
  WorkbookReceiptReport
} from "./reportTypes";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value: number): string {
  return value.toLocaleString("ar-SA-u-nu-latn");
}

function formatPercentage(value: number): string {
  return `${value.toLocaleString("ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function kpi(label: string, value: number | string): string {
  const renderedValue =
    typeof value === "number" ? formatNumber(value) : escapeHtml(value);

  return `
    <div class="kpi">
      <strong>${renderedValue}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function emptyState(message: string): string {
  return `
    <div class="empty-state">
      ${escapeHtml(message)}
    </div>
  `;
}

function buildToolbar(data: PopulationReportData): string {
  return `
    <div class="report-toolbar no-print">
      <div>
        <strong>${escapeHtml(data.title)}</strong>
        <span>${escapeHtml(data.phaseLabel)}</span>
      </div>
      <button type="button" onclick="window.print()">طباعة / حفظ PDF</button>
    </div>
  `;
}

function buildCoverPage(data: PopulationReportData): string {
  return `
    <section class="slide cover">
      <div class="strip"></div>

      <div class="cover-grid">
        <div>
          <div class="kicker">Population Processing Report</div>
          <h1>${escapeHtml(data.title)}</h1>
          <p>${escapeHtml(data.phaseLabel)} — ${escapeHtml(data.generatedMonth)}</p>

          <div class="badge ${escapeHtml(data.status)}">
            ${escapeHtml(data.statusLabel)}
          </div>

          <p class="status-message">${escapeHtml(data.statusMessage)}</p>
        </div>

        <div class="panel executive-panel">
          <h3>نظرة تنفيذية</h3>
          ${kpi(
            "وكالة تحليل المخاطر المقبولة",
            data.riskReceipt?.totalNormalizedRows ?? 0
          )}
          ${kpi(
            "ذكاء الأعمال المقبولة",
            data.biReceipt?.totalNormalizedRows ?? 0
          )}
          ${kpi(
            "المجتمع النهائي",
            data.processing?.finalPreparedPopulationRows ?? "لم تتم المعالجة"
          )}
        </div>
      </div>

      <footer>
        <span>${escapeHtml(data.generatedDate)} — ${escapeHtml(data.generatedTime)}</span>
        <span>${escapeHtml(data.phaseLabel)}</span>
      </footer>
    </section>
  `;
}

function buildWorkbookReceiptTable(receipt: WorkbookReceiptReport): string {
  if (!receipt.provided) {
    return emptyState("لم يتم رفع أو قراءة هذا الملف.");
  }

  if (receipt.sheets.length === 0) {
    return emptyState("لا توجد أوراق مقروءة لهذا الملف.");
  }

  const rows = receipt.sheets
    .map(
      (sheet) => `
        <tr>
          <td>${escapeHtml(sheet.sheetName)}</td>
          <td>${formatNumber(sheet.originalRowCount)}</td>
          <td>${formatNumber(sheet.normalizedRowCount)}</td>
          <td>${formatNumber(sheet.excludedMissingXrayIdCount)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>الورقة</th>
          <th>البيانات الواردة</th>
          <th>المقبولة قبل المعالجة</th>
          <th>المستبعدة عند القراءة</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td>المجموع</td>
          <td>${formatNumber(receipt.totalOriginalRows)}</td>
          <td>${formatNumber(receipt.totalNormalizedRows)}</td>
          <td>${formatNumber(receipt.totalExcludedRows)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function buildReceiptPage(data: PopulationReportData): string {
  return `
    <section class="slide">
      <header>
        <div>
          <div class="kicker">01 / Received Data</div>
          <h2>ملخص البيانات المستلمة</h2>
          <p>يعرض هذا القسم ملخص البيانات المقروءة من وكالة تحليل المخاطر وذكاء الأعمال قبل معالجة المجتمع.</p>
        </div>
        <b>2</b>
      </header>

      <div class="grid4">
        ${kpi(
          "بيانات وكالة تحليل المخاطر الواردة",
          data.riskReceipt?.totalOriginalRows ?? 0
        )}
        ${kpi(
          "وكالة تحليل المخاطر المقبولة",
          data.riskReceipt?.totalNormalizedRows ?? 0
        )}
        ${kpi(
          "بيانات ذكاء الأعمال الواردة",
          data.biReceipt?.totalOriginalRows ?? 0
        )}
        ${kpi(
          "ذكاء الأعمال المقبولة",
          data.biReceipt?.totalNormalizedRows ?? 0
        )}
      </div>

      <div class="two">
        <div class="panel">
          <h3>بيانات وكالة تحليل المخاطر</h3>
          ${
            data.riskReceipt
              ? buildWorkbookReceiptTable(data.riskReceipt)
              : emptyState("لا توجد بيانات وكالة تحليل مخاطر.")
          }
        </div>

        <div class="panel">
          <h3>بيانات ذكاء الأعمال</h3>
          ${
            data.biReceipt
              ? buildWorkbookReceiptTable(data.biReceipt)
              : emptyState("لا توجد بيانات ذكاء أعمال.")
          }
        </div>
      </div>

      <footer>
        <span>${escapeHtml(data.title)}</span>
        <span>صفحة 2</span>
      </footer>
    </section>
  `;
}

function buildStageDistributionTable(
  rows: RiskStageDistributionRow[],
  totals: RiskStageDistributionRow | null
): string {
  if (rows.length === 0 || !totals) {
    return emptyState("لا توجد بيانات مستوى متاحة.");
  }

  const bodyRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.sheetName)}</td>
          <td>${formatNumber(row.first)}</td>
          <td>${formatNumber(row.second)}</td>
          <td>${formatNumber(row.third)}</td>
          <td>${formatNumber(row.fourth)}</td>
          <td>${formatNumber(row.unknown)}</td>
          <td>${formatNumber(row.totalAccepted)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>الورقة</th>
          <th>المستوى الأول</th>
          <th>المستوى الثاني</th>
          <th>المستوى الثالث</th>
          <th>المستوى الرابع</th>
          <th>غير محدد</th>
          <th>إجمالي الصفوف المقبولة</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total-row">
          <td>المجموع</td>
          <td>${formatNumber(totals.first)}</td>
          <td>${formatNumber(totals.second)}</td>
          <td>${formatNumber(totals.third)}</td>
          <td>${formatNumber(totals.fourth)}</td>
          <td>${formatNumber(totals.unknown)}</td>
          <td>${formatNumber(totals.totalAccepted)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function buildStageDistributionPage(data: PopulationReportData): string {
  return `
    <section class="slide">
      <header>
        <div>
          <div class="kicker">02 / Risk Stage Distribution</div>
          <h2>توزيع بيانات وكالة تحليل المخاطر حسب المستوى</h2>
          <p>يعرض هذا القسم توزيع الصفوف المقبولة قبل المعالجة حسب مراحل الفحص في بيانات وكالة تحليل المخاطر.</p>
        </div>
        <b>3</b>
      </header>

      <div class="panel wide-panel">
        <h3>توزيع المستويات</h3>
        ${buildStageDistributionTable(
          data.riskStageDistribution,
          data.riskStageDistributionTotals
        )}
      </div>

      <footer>
        <span>${escapeHtml(data.title)}</span>
        <span>صفحة 3</span>
      </footer>
    </section>
  `;
}

function buildProcessingPage(data: PopulationReportData): string {
  const processing = data.processing;

  if (!processing) {
    return `
      <section class="slide">
        <header>
          <div>
            <div class="kicker">03 / Processing Summary</div>
            <h2>لم يتم تنفيذ معالجة المجتمع بعد</h2>
            <p>يعرض هذا التقرير بيانات الاستلام فقط لأن معالجة المجتمع لم يتم تشغيلها.</p>
          </div>
          <b>4</b>
        </header>

        ${emptyState("اضغط على زر معالجة المجتمع في المرحلة الثانية لإظهار مخرجات المعالجة في التقرير.")}

        <footer>
          <span>${escapeHtml(data.title)}</span>
          <span>صفحة 4</span>
        </footer>
      </section>
    `;
  }

  const totalExcludedAfterProcessing =
    processing.invalidRiskIdRows +
    processing.duplicateRiskIdRows +
    processing.removedInvalidResultRows;

  const reconciliationFormula = `${formatNumber(
    processing.validRiskIdRows
  )} - ${formatNumber(processing.duplicateRiskIdRows)} - ${formatNumber(
    processing.removedInvalidResultRows
  )} = ${formatNumber(processing.finalPreparedPopulationRows)}`;

  return `
    <section class="slide">
      <header>
        <div>
          <div class="kicker">03 / Processing Summary</div>
          <h2>ملخص معالجة المجتمع</h2>
          <p>يعرض هذا القسم أثر الاستبعاد والتكرارات والنتائج غير الصالحة على تكوين المجتمع النهائي.</p>
        </div>
        <b>4</b>
      </header>

      <div class="grid5 compact-kpis">
        ${kpi("بيانات وكالة تحليل المخاطر الواردة", processing.riskOriginalRows)}
        ${kpi("المستبعدة بعد المعالجة", totalExcludedAfterProcessing)}
        ${kpi("مكررات مستبعدة", processing.duplicateRiskIdRows)}
        ${kpi("نتائج غير صالحة", processing.removedInvalidResultRows)}
        ${kpi("المجتمع النهائي", processing.finalPreparedPopulationRows)}
      </div>

      <div class="two processing-two">
        <div class="panel">
          <h3>ملخص الاستبعاد</h3>
          <table>
            <tbody>
              <tr>
                <td>معرفات غير صالحة</td>
                <td>${formatNumber(processing.invalidRiskIdRows)}</td>
              </tr>
              <tr>
                <td>مكررات مستبعدة</td>
                <td>${formatNumber(processing.duplicateRiskIdRows)}</td>
              </tr>
              <tr>
                <td>نتائج غير صالحة</td>
                <td>${formatNumber(processing.removedInvalidResultRows)}</td>
              </tr>
              <tr class="total-row">
                <td>إجمالي المستبعد بعد المعالجة</td>
                <td>${formatNumber(totalExcludedAfterProcessing)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h3>تسوية أعداد المعالجة</h3>
          <div class="reconciliation">
            <p>احتساب المجتمع بعد المعالجة:</p>
            <strong>المعرفات الصالحة - المكررات المستبعدة - النتائج غير الصالحة = المجتمع النهائي</strong>
            <p class="formula-line">${escapeHtml(reconciliationFormula)}</p>
          </div>
        </div>
      </div>

      <footer>
        <span>${escapeHtml(data.title)}</span>
        <span>صفحة 4</span>
      </footer>
    </section>
  `;
}

function buildCertScanAndBiPage(data: PopulationReportData): string {
  const processing = data.processing;

  if (!processing) {
    return `
      <section class="slide">
        <header>
          <div>
            <div class="kicker">04 / Business Intelligence and CertScan</div>
            <h2>لم يتم تنفيذ مطابقة ذكاء الأعمال ونظام سيرت سكان بعد</h2>
            <p>يظهر هذا القسم بعد تنفيذ معالجة المجتمع.</p>
          </div>
          <b>5</b>
        </header>

        ${emptyState("لا توجد نتائج معالجة لعرض مطابقة ذكاء الأعمال أو تصنيف نظام سيرت سكان.")}

        <footer>
          <span>${escapeHtml(data.title)}</span>
          <span>صفحة 5</span>
        </footer>
      </section>
    `;
  }

  return `
    <section class="slide">
      <header>
        <div>
          <div class="kicker">04 / Business Intelligence and CertScan</div>
          <h2>ملخص نظام سيرت سكان وذكاء الأعمال</h2>
          <p>يعرض هذا القسم أثر قائمة نظام سيرت سكان وملف ذكاء الأعمال على المجتمع النهائي.</p>
        </div>
        <b>5</b>
      </header>

      <div class="grid4">
        ${kpi("نظام سيرت سكان", processing.certScanRows)}
        ${kpi("غير مصنف كنظام سيرت سكان", processing.nonCertScanRows)}
        ${kpi("مطابقة ذكاء الأعمال", processing.biMatchedRows)}
        ${kpi("تعبئة من ذكاء الأعمال", processing.totalBiFilledFields)}
      </div>

      <div class="two">
        <div class="panel">
          <h3>نسب نظام سيرت سكان</h3>
          <table>
            <tbody>
              <tr>
                <td>نظام سيرت سكان</td>
                <td>${formatPercentage(processing.certScanPercentage)}</td>
              </tr>
              <tr>
                <td>غير مصنف كنظام سيرت سكان</td>
                <td>${formatPercentage(processing.nonCertScanPercentage)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h3>ملخص ذكاء الأعمال</h3>
          <table>
            <tbody>
              <tr>
                <td>تم رفع بيانات ذكاء الأعمال</td>
                <td>${processing.biProvided ? "نعم" : "لا"}</td>
              </tr>
              <tr>
                <td>نسبة المطابقة</td>
                <td>${formatPercentage(processing.biMatchPercentage)}</td>
              </tr>
              <tr>
                <td>غير مطابق</td>
                <td>${formatNumber(processing.biUnmatchedRows)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <footer>
        <span>${escapeHtml(data.title)}</span>
        <span>صفحة 5</span>
      </footer>
    </section>
  `;
}

function buildBiRiskFieldComparisonTable(data: PopulationReportData): string {
  const rows = data.biRiskComparison.fieldComparisons;

  if (rows.length === 0) {
    return emptyState("لا توجد بيانات مقارنة حسب الأعمدة.");
  }

  const bodyRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.fieldName)}</td>
          <td>${formatNumber(row.matchedCount)}</td>
          <td>${formatNumber(row.differentCount)}</td>
          <td>${formatPercentage(row.matchPercentage)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table class="compact-table">
      <thead>
        <tr>
          <th>العمود</th>
          <th>مطابق</th>
          <th>مختلف</th>
          <th>نسبة المطابقة</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function buildBiRiskDifferentSampleTable(data: PopulationReportData): string {
  const rows = data.biRiskComparison.sampleDifferentRows;

  if (rows.length === 0) {
    return emptyState("لا توجد اختلافات ظاهرة في السجلات المطابقة.");
  }

  const bodyRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.xrayImageId)}</td>
          <td>${escapeHtml(row.portName)}</td>
          <td>${escapeHtml(row.differentFields.join("، "))}</td>
        </tr>
      `
    )
    .join("");

  return `
    <table class="compact-table">
      <thead>
        <tr>
          <th>معرف الأشعة</th>
          <th>اسم المنفذ</th>
          <th>الأعمدة المختلفة</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function buildBiRiskComparisonPage(data: PopulationReportData): string {
  const comparison = data.biRiskComparison;

  return `
    <section class="slide">
      <header>
        <div>
          <div class="kicker">05 / BI vs Risk Agency Comparison</div>
          <h2>ملخص مقارنة البيانات بين ذكاء الأعمال ووكالة تحليل المخاطر</h2>
          <p>يعرض هذا القسم مقارنة السجلات المطابقة حسب معرف الأشعة واسم المنفذ، ويوضح الأعمدة التي يوجد بها اختلاف ونسبة المطابقة لكل عمود.</p>
        </div>
        <b>6</b>
      </header>

      <div class="grid4 compact-kpis">
        ${kpi("السجلات المطابقة", comparison.totalMatchedRecords)}
        ${kpi("مطابقة بدون اختلاف", comparison.matchedWithoutDifferences)}
        ${kpi("مطابقة مع اختلاف", comparison.matchedWithDifferences)}
        ${kpi("نسبة المطابقة", formatPercentage(comparison.overallMatchPercentage))}
      </div>

      <div class="two">
        <div class="panel">
          <h3>نسبة المطابقة حسب العمود</h3>
          ${buildBiRiskFieldComparisonTable(data)}
        </div>

        <div class="panel">
          <h3>عينات من السجلات المختلفة</h3>
          ${buildBiRiskDifferentSampleTable(data)}
        </div>
      </div>

      <footer>
        <span>${escapeHtml(data.title)}</span>
        <span>صفحة 6</span>
      </footer>
    </section>
  `;
}

function buildBiFillSummaryTable(rows: BiFillReportRow[]): string {
  if (rows.length === 0) {
    return emptyState("لا توجد خانات تم تعبئتها من بيانات ذكاء الأعمال.");
  }

  const visibleRows = rows.slice(0, 10);
  const hiddenRowCount = Math.max(rows.length - visibleRows.length, 0);

  const bodyRows = visibleRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.fieldName)}</td>
          <td>${formatNumber(row.riskEmptyBefore)}</td>
          <td>${formatNumber(row.filledFromBi)}</td>
          <td>${formatNumber(row.stillEmptyAfter)}</td>
          <td>${formatPercentage(row.fillPercentage)}</td>
        </tr>
      `
    )
    .join("");

  const noteRow =
    hiddenRowCount > 0
      ? `
        <tr class="note-row">
          <td colspan="5">
            تم عرض أول ${formatNumber(visibleRows.length)} صفوف فقط. توجد ${formatNumber(hiddenRowCount)} صفوف إضافية في ملف Excel التفصيلي.
          </td>
        </tr>
      `
      : "";

  return `
    <table class="compact-table">
      <thead>
        <tr>
          <th>الحقل</th>
          <th>فارغ في وكالة تحليل المخاطر قبل ذكاء الأعمال</th>
          <th>تمت تعبئته من ذكاء الأعمال</th>
          <th>بقي فارغاً بعد التعبئة</th>
          <th>نسبة التعبئة</th>
        </tr>
      </thead>
      <tbody>${bodyRows}${noteRow}</tbody>
    </table>
  `;
}

function buildBiFillSummaryPage(data: PopulationReportData): string {
  return `
    <section class="slide">
      <header>
        <div>
          <div class="kicker">06 / Business Intelligence Fill Summary</div>
          <h2>ملخص تعبئة الخانات من بيانات ذكاء الأعمال</h2>
          <p>يعرض هذا القسم عدد الخانات التي كانت فارغة في بيانات وكالة تحليل المخاطر وتمت تعبئتها من بيانات ذكاء الأعمال.</p>
        </div>
        <b>7</b>
      </header>

      <div class="panel wide-panel comparison-panel">
        <h3>تفاصيل التعبئة من ذكاء الأعمال</h3>
        ${buildBiFillSummaryTable(data.biFillSummary)}
      </div>

      <footer>
        <span>${escapeHtml(data.title)}</span>
        <span>صفحة 7</span>
      </footer>
    </section>
  `;
}

function buildReadinessPage(data: PopulationReportData): string {
  return `
    <section class="slide">
      <header>
        <div>
          <div class="kicker">07 / Readiness Statement</div>
          <h2>حالة الجاهزية للمرحلة التالية</h2>
          <p>يعرض هذا القسم ما إذا كان المجتمع النهائي جاهزاً للانتقال إلى اختيار العينة.</p>
        </div>
        <b>8</b>
      </header>

      <div class="readiness ${escapeHtml(data.status)}">
        <h3>${escapeHtml(data.statusLabel)}</h3>
        <p>${escapeHtml(data.statusMessage)}</p>
      </div>

      <div class="grid4">
        ${kpi(
          "المجتمع النهائي",
          data.processing?.finalPreparedPopulationRows ?? 0
        )}
        ${kpi("المكررات", data.processing?.duplicateRiskIdRows ?? 0)}
        ${kpi("معرفات غير صالحة", data.processing?.invalidRiskIdRows ?? 0)}
        ${kpi("نتائج غير صالحة", data.processing?.removedInvalidResultRows ?? 0)}
      </div>

      <footer>
        <span>${escapeHtml(data.title)}</span>
        <span>صفحة 8</span>
      </footer>
    </section>
  `;
}

function buildCss(): string {
  return `
    @page {
      size: 13.333in 7.5in;
      margin: 0;
    }

    :root {
      --primary: #17365d;
      --gold: #b88a2e;
      --green: #027a48;
      --red: #b42318;
      --orange: #92400e;
      --blue: #3730a3;
      --muted: #667085;
      --border: #d8dee7;
      --soft: #f8fafc;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      direction: rtl;
      font-family: "Somar", "Somar Sans", "Segoe UI", Tahoma, Arial, sans-serif;
      background: #d9dee7;
      color: #172033;
    }

    .report-toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 12px 18px;
      background: rgba(255, 255, 255, 0.96);
      border-bottom: 1px solid var(--border);
      box-shadow: 0 10px 25px rgba(31, 41, 55, 0.08);
    }

    .report-toolbar strong {
      display: block;
      color: var(--primary);
      font-size: 14px;
      font-weight: 700;
    }

    .report-toolbar span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
    }

    .report-toolbar button {
      border: 0;
      border-radius: 14px;
      padding: 10px 16px;
      background: var(--primary);
      color: white;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .slide {
      width: 13.333in;
      height: 7.5in;
      page-break-after: always;
      overflow: hidden;
      position: relative;
      background: linear-gradient(180deg, #ffffff, #f8fbff);
      padding: 0.42in 0.55in;
    }

    .slide:last-child {
      page-break-after: auto;
    }

    .strip {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 0.16in;
      background: linear-gradient(180deg, var(--primary), var(--gold));
    }

    .cover-grid {
      height: 6.35in;
      display: grid;
      grid-template-columns: 1.55fr 0.85fr;
      gap: 0.45in;
      align-items: center;
    }

    .kicker {
      color: var(--gold);
      font-size: 0.16in;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .cover h1 {
      margin: 0.18in 0 0;
      color: var(--primary);
      font-size: 0.52in;
      line-height: 1.32;
      font-weight: 700;
    }

    .cover p,
    header p {
      color: var(--muted);
      line-height: 1.7;
      font-weight: 300;
    }

    .status-message {
      max-width: 7in;
      margin-top: 0.2in;
      font-size: 0.16in;
    }

    .badge {
      display: inline-flex;
      margin-top: 0.25in;
      padding: 0.13in 0.24in;
      border-radius: 999px;
      font-weight: 700;
    }

    .ready-for-next-phase {
      background: #ecfdf3;
      color: var(--green);
    }

    .usable-with-notes,
    .receipt-only {
      background: #fffbeb;
      color: var(--orange);
    }

    .not-ready {
      background: #fef3f2;
      color: var(--red);
    }

    .panel {
      background: white;
      border: 1px solid var(--border);
      border-radius: 0.2in;
      padding: 0.16in;
      box-shadow: 0 10px 24px rgba(31, 41, 55, 0.06);
    }

    .executive-panel {
      padding: 0.18in;
    }

    .wide-panel {
      margin-top: 0.25in;
    }

    .panel h3 {
      margin: 0 0 0.12in;
      color: var(--primary);
      font-size: 0.18in;
      font-weight: 700;
    }

    .kpi {
      background: white;
      border: 1px solid var(--border);
      border-radius: 0.17in;
      padding: 0.1in;
      height: 0.82in;
      min-height: 0.82in;
      max-height: 0.82in;
      display: flex;
      flex-direction: column;
      justify-content: center;
      overflow: hidden;
    }

    .kpi + .kpi {
      margin-top: 0.1in;
    }

    .kpi strong {
      display: block;
      color: var(--primary);
      font-size: 0.23in;
      font-weight: 700;
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum";
      line-height: 1.05;
    }

    .kpi span {
      display: block;
      margin-top: 0.03in;
      color: var(--muted);
      font-size: 0.074in;
      font-weight: 500;
      line-height: 1.15;
    }

    header {
      display: flex;
      justify-content: space-between;
      border-bottom: 3px solid var(--primary);
      padding-bottom: 0.16in;
    }

    header h2 {
      margin: 0.07in 0 0;
      color: var(--primary);
      font-size: 0.31in;
      line-height: 1.25;
      font-weight: 700;
    }

    header b {
      width: 0.42in;
      height: 0.42in;
      border-radius: 999px;
      display: grid;
      place-items: center;
      color: white;
      background: var(--primary);
      font-weight: 700;
    }

    .grid4 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.13in;
      margin-top: 0.2in;
    }

    .grid5 {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.11in;
      margin-top: 0.2in;
    }

    .compact-kpis .kpi {
      height: 0.82in;
      min-height: 0.82in;
      max-height: 0.82in;
      padding: 0.08in;
    }

    .compact-kpis .kpi strong {
      font-size: 0.22in;
    }

    .compact-kpis .kpi span {
      font-size: 0.07in;
      line-height: 1.12;
    }

    .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.2in;
      margin-top: 0.2in;
    }

    .processing-two {
      margin-top: 0.24in;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.088in;
    }

    th,
    td {
      border-bottom: 1px solid var(--border);
      padding: 0.04in 0.03in;
      text-align: center;
      vertical-align: middle;
    }

    th {
      background: var(--primary);
      color: white;
      font-weight: 700;
    }

    td {
      font-weight: 400;
    }

    .total-row td {
      background: #f3f6fa;
      color: var(--primary);
      font-weight: 700;
    }

    .compact-table {
      font-size: 0.082in;
    }

    .compact-table th,
    .compact-table td {
      padding: 0.035in 0.025in;
    }

    .comparison-panel {
      margin-top: 0.18in;
      max-height: 3.75in;
      overflow: hidden;
    }

    .note-row td {
      background: #fffbeb;
      color: var(--orange);
      font-weight: 700;
      text-align: center;
    }

    .reconciliation {
      border: 1px dashed var(--border);
      border-radius: 0.16in;
      padding: 0.16in;
      background: var(--soft);
      line-height: 1.7;
    }

    .reconciliation p {
      margin: 0 0 0.1in;
    }

    .reconciliation strong {
      color: var(--primary);
      display: block;
      margin: 0.08in 0;
      line-height: 1.6;
    }

    .reconciliation b {
      color: var(--primary);
      font-size: 0.18in;
    }

    .formula-line {
      direction: ltr;
      text-align: right;
      font-size: 0.18in;
      color: var(--primary);
      font-weight: 700;
    }

    .readiness {
      margin-top: 0.28in;
      padding: 0.28in;
      border-radius: 0.22in;
      border: 1px solid var(--border);
    }

    .readiness h3 {
      margin: 0;
      font-size: 0.28in;
      font-weight: 700;
    }

    .readiness p {
      margin: 0.12in 0 0;
      font-size: 0.16in;
      line-height: 1.8;
    }

    .empty-state {
      border: 1px dashed var(--border);
      background: var(--soft);
      border-radius: 0.16in;
      padding: 0.2in;
      color: var(--muted);
      font-weight: 500;
      line-height: 1.7;
      text-align: center;
    }

    footer {
      position: absolute;
      left: 0.55in;
      right: 0.55in;
      bottom: 0.22in;
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 0.11in;
      border-top: 1px solid var(--border);
      padding-top: 0.08in;
    }

    @media print {
      body {
        background: white;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .no-print {
        display: none !important;
      }
    }
  `;
}

export function buildPopulationReportHtml(data: PopulationReportData): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(data.title)}</title>
  <style>${buildCss()}</style>
</head>
<body>
  ${buildToolbar(data)}
  ${buildCoverPage(data)}
  ${buildReceiptPage(data)}
  ${buildStageDistributionPage(data)}
  ${buildProcessingPage(data)}
  ${buildCertScanAndBiPage(data)}
  ${buildBiRiskComparisonPage(data)}
  ${buildBiFillSummaryPage(data)}
  ${buildReadinessPage(data)}
</body>
</html>`;
}