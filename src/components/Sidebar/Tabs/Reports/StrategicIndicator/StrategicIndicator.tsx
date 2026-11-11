import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./StrategicIndicator.css";
import { PageHeader } from "../../../../PageHeader/PageHeader";
import { usePermissions } from "../../../../../auth/usePermissions";
import { useLabels } from "../../../../../data/labels/useLabels";
import { useWorkspace } from "../../../../../data/workspace/useWorkspace";
import { logError } from "../../../../../data/storage/errorLogger";
import { downloadBlob } from "../../../../../utils/downloadFile";
import {
  addMonthStageCounts,
  buildIndicatorCard,
  countByMonthStage,
  INDICATOR_STAGES,
  type IndicatorMonth,
  type IndicatorStage,
} from "../../../../../data/strategicIndicator/indicatorModel";
import {
  collectIndicatorSystemData,
  toIndicatorAppends,
  type IndicatorSystemData,
} from "../../../../../data/strategicIndicator/indicatorSystemData";
import { loadStoredIndicator, saveIndicatorTemplate, type StoredIndicator } from "../../../../../data/strategicIndicator/indicatorStorage";
import {
  buildIndicatorWorkbook,
  scanIndicatorWorkbook,
  type MonthStageCounts,
} from "../../../../../data/strategicIndicator/indicatorTemplate";

type Stored = { status: "loading" } | { status: "none" } | ({ status: "ready" } & StoredIndicator);
type SystemState = { status: "idle" | "loading" | "error" } | { status: "ready"; data: IndicatorSystemData };
type Busy = { kind: "upload"; sheet: string | null } | { kind: "export" } | null;

const number = (value: number) => value.toLocaleString("en-US");
const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function totalOf(counts: MonthStageCounts): number {
  let total = 0;
  for (const byStage of Object.values(counts)) for (const value of Object.values(byStage)) total += value;
  return total;
}

/**
 * «متابعة المؤشر الاستراتيجي». The owner uploads the indicator workbook once;
 * the page then shows the card from the workbook's own data plus whatever the
 * system has processed and studied since, and exports the same workbook with
 * those rows appended (see `src/data/strategicIndicator/`).
 */
export default function StrategicIndicator() {
  const labels = useLabels();
  const { directoryHandle } = useWorkspace();
  const { can } = usePermissions();
  const canExport = can("export-reports");
  const [stored, setStored] = useState<Stored>({ status: "loading" });
  const [system, setSystem] = useState<SystemState>({ status: "idle" });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadToken = useRef(0);

  const collect = useCallback(
    async (indicator: StoredIndicator) => {
      if (!directoryHandle) return;
      const token = ++loadToken.current;
      setSystem({ status: "loading" });
      try {
        const data = await collectIndicatorSystemData(directoryHandle, indicator.baseline);
        if (token === loadToken.current) setSystem({ status: "ready", data });
      } catch (err) {
        logError("strategicIndicator:collect", err);
        if (token === loadToken.current) setSystem({ status: "error" });
      }
    },
    [directoryHandle]
  );

  useEffect(() => {
    if (!directoryHandle) return undefined;
    let alive = true;
    void loadStoredIndicator(directoryHandle)
      .then((indicator) => {
        if (!alive) return;
        setStored(indicator ? { status: "ready", ...indicator } : { status: "none" });
        if (indicator) void collect(indicator);
      })
      .catch((err) => {
        logError("strategicIndicator:load", err);
        if (alive) setStored({ status: "none" });
      });
    return () => {
      alive = false;
    };
  }, [collect, directoryHandle]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !directoryHandle) return;
    if (!canExport) {
      setError(labels.si_not_permitted);
      return;
    }
    setError(null);
    setBusy({ kind: "upload", sheet: null });
    try {
      const baseline = await scanIndicatorWorkbook(file, file.name, (sheet) => setBusy({ kind: "upload", sheet }));
      setBusy({ kind: "upload", sheet: null });
      await saveIndicatorTemplate(directoryHandle, file, baseline);
      // Read back from the workspace, so the page works from the stored copy from now on.
      const indicator = (await loadStoredIndicator(directoryHandle)) ?? { baseline, template: file };
      setStored({ status: "ready", ...indicator });
      void collect(indicator);
    } catch (err) {
      logError("strategicIndicator:upload", err);
      setError(labels.si_upload_failed.replace("{error}", errorText(err)));
    } finally {
      setBusy(null);
    }
  }

  async function handleExport(): Promise<void> {
    if (stored.status !== "ready" || system.status !== "ready") return;
    if (!canExport) {
      setError(labels.si_not_permitted);
      return;
    }
    setError(null);
    setBusy({ kind: "export" });
    try {
      const workbook = await buildIndicatorWorkbook(
        stored.template,
        stored.baseline,
        toIndicatorAppends(system.data, stored.baseline)
      );
      downloadBlob(workbook, labels.si_export_file_name.replace("{date}", new Date().toISOString().slice(0, 10)));
    } catch (err) {
      logError("strategicIndicator:export", err);
      setError(labels.si_export_failed.replace("{error}", errorText(err)));
    } finally {
      setBusy(null);
    }
  }

  const card = useMemo<IndicatorMonth[]>(() => {
    if (stored.status !== "ready") return [];
    const data = system.status === "ready" ? system.data : null;
    const datedSamples = (data?.sampleRows ?? []).flatMap((row) =>
      row.month === null ? [] : [{ month: row.month, stageCode: row.stageCode }]
    );
    return buildIndicatorCard({
      population: addMonthStageCounts(stored.baseline.population, countByMonthStage(data?.populationRows ?? [])),
      samples: addMonthStageCounts(stored.baseline.samples, countByMonthStage(datedSamples)),
      targets: stored.baseline.targets,
      cardMonths: stored.baseline.cardMonths,
    });
  }, [stored, system]);

  const levelLabels: Record<IndicatorStage, string> = {
    first: labels.si_level_first,
    second: labels.si_level_second,
    third: labels.si_level_third,
    fourth: labels.si_level_fourth,
  };
  const monthsOutsideCard = card.filter((month) => !month.inCard).map((month) => month.label);
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".xlsx"
      className="si-file-input"
      aria-label={labels.si_choose_file}
      data-testid="si-file-input"
      disabled={busy !== null}
      onChange={(event) => void handleFile(event)}
    />
  );

  return (
    <section className="page-shell si-page" dir="rtl" data-testid="strategic-indicator">
      <PageHeader eyebrow={labels.si_eyebrow} title={labels.si_title} subtitle={labels.si_subtitle} />

      {stored.status === "loading" && <p className="si-status" role="status">{labels.si_loading}</p>}

      {stored.status === "none" && (
        <div className="si-panel">
          <p className="si-hint">{labels.si_upload_prompt}</p>
          {fileInput}
        </div>
      )}

      {busy?.kind === "upload" && (
        <p className="si-status" role="status">
          {busy.sheet ? labels.si_reading.replace("{sheet}", busy.sheet) : labels.si_saving}
        </p>
      )}
      {error && <p className="si-error" role="alert">{error}</p>}

      {stored.status === "ready" && (
        <>
          <div className="si-panel">
            <p className="si-hint" dir="auto">
              {labels.si_file_line
                .replace("{name}", stored.baseline.fileName)
                .replace("{date}", stored.baseline.scannedAt.slice(0, 10))
                .replace("{population}", number(totalOf(stored.baseline.population)))
                .replace("{samples}", number(stored.baseline.sampleIds.length))}
            </p>
            <div className="si-actions">
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                disabled={busy !== null || system.status !== "ready" || !canExport}
                onClick={() => void handleExport()}
              >
                {busy?.kind === "export" ? labels.si_exporting : labels.si_export}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                disabled={busy !== null || system.status === "loading"}
                onClick={() => void collect(stored)}
              >
                {labels.si_refresh}
              </button>
              <label className="si-replace">
                <span>{labels.si_replace_file}</span>
                {fileInput}
              </label>
            </div>
            {system.status === "loading" && <p className="si-status" role="status">{labels.si_collecting}</p>}
            {system.status === "error" && <p className="si-error" role="alert">{labels.si_collect_failed}</p>}
            {system.status === "ready" && <SystemNotes data={system.data} monthsOutsideCard={monthsOutsideCard} />}
          </div>

          <div className="si-scroll">
            <table className="si-card" aria-label={labels.si_card_aria}>
              <thead>
                <tr>
                  <th rowSpan={2} className="si-sticky">{labels.si_col_level}</th>
                  {card.map((month) => (
                    <th key={month.dataMonth} colSpan={5} className={month.inCard ? "si-month" : "si-month si-month--new"}>
                      {month.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {card.flatMap((month) =>
                    [labels.si_col_population, labels.si_col_target, labels.si_col_sample, labels.si_col_deficit, labels.si_col_ratio].map(
                      (title) => <th key={`${month.dataMonth}-${title}`}>{title}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {INDICATOR_STAGES.map((stage) => (
                  <tr key={stage}>
                    <th scope="row" className="si-sticky">{levelLabels[stage]}</th>
                    {card.flatMap((month) => {
                      const cell = month.stages[stage];
                      return [
                        <td key={`${month.dataMonth}-p`}>{number(cell.population)}</td>,
                        <td key={`${month.dataMonth}-t`}>{number(cell.target)}</td>,
                        <td key={`${month.dataMonth}-s`}>{number(cell.sample)}</td>,
                        <td key={`${month.dataMonth}-d`} className={cell.deficit < 0 ? "si-deficit" : undefined}>{number(cell.deficit)}</td>,
                        <td key={`${month.dataMonth}-r`}>{percent(cell.ratio)}</td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="si-sticky">{labels.si_row_total}</th>
                  {card.flatMap((month) => [
                    <td key={`${month.dataMonth}-p`}>{number(month.total.population)}</td>,
                    <td key={`${month.dataMonth}-t`}>{number(month.total.target)}</td>,
                    <td key={`${month.dataMonth}-s`}>{number(month.total.sample)}</td>,
                    <td key={`${month.dataMonth}-d`} className={month.total.deficit < 0 ? "si-deficit" : undefined}>{number(month.total.deficit)}</td>,
                    <td key={`${month.dataMonth}-r`}>{percent(month.achievement)}</td>,
                  ])}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="si-panel">
            <h2 className="si-heading">{labels.si_progress_title}</h2>
            <table className="si-progress">
              <thead>
                <tr>
                  <th>{labels.si_progress_month}</th>
                  <th>{labels.si_progress_monthly}</th>
                  <th>{labels.si_progress_cumulative}</th>
                </tr>
              </thead>
              <tbody>
                {card.map((month) => (
                  <tr key={month.dataMonth}>
                    <th scope="row">{month.label}</th>
                    <td>{percent(month.achievement)}</td>
                    <td>{percent(month.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function SystemNotes({ data, monthsOutsideCard }: { data: IndicatorSystemData; monthsOutsideCard: string[] }) {
  const labels = useLabels();
  const hasNew = data.populationRows.length > 0 || data.sampleRows.length > 0;
  return (
    <>
      <p className="si-status" role="status">
        {hasNew
          ? labels.si_new_rows
              .replace("{population}", number(data.populationRows.length))
              .replace("{samples}", number(data.sampleRows.length))
          : labels.si_nothing_new}
      </p>
      {monthsOutsideCard.length > 0 && (
        <p className="si-warn">{labels.si_month_not_in_card.replace("{months}", monthsOutsideCard.join("، "))}</p>
      )}
      {data.failedSources.length > 0 && (
        <p className="si-error" role="alert">{labels.si_failed_sources.replace("{sources}", data.failedSources.join("، "))}</p>
      )}
      {data.skipped.unknownStage > 0 && (
        <p className="si-warn">{labels.si_skipped_stage.replace("{n}", number(data.skipped.unknownStage))}</p>
      )}
      {data.skipped.undatedPopulation > 0 && (
        <p className="si-warn">{labels.si_skipped_undated.replace("{n}", number(data.skipped.undatedPopulation))}</p>
      )}
    </>
  );
}
