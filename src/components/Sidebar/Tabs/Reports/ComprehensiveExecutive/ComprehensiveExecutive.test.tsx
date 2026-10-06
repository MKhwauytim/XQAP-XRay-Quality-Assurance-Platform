/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import { getLabels } from "../../../../../data/labels/labelsStore";
import { newMappingReport, mapSampleRow } from "../../../../../data/workbookImport/workbookColumnMap";
import { COMPREHENSIVE_MONTH_LABEL } from "../../../../../data/workbookImport/mergeWithSystem";
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import type { ComprehensiveWorkerMessage } from "../../../../../workers/comprehensiveWorkbookWorkerTypes";

interface WorkerStub {
  listeners: Map<string, Set<(ev: unknown) => void>>;
  posted: unknown[];
  terminated: boolean;
  emit(msg: ComprehensiveWorkerMessage): void;
}
const workers = vi.hoisted((): WorkerStub[] => []);

vi.mock("../../../../../workers/comprehensiveWorkbookWorker?worker&inline", () => {
  class Stub implements WorkerStub {
    listeners = new Map<string, Set<(ev: unknown) => void>>();
    posted: unknown[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: (ev: unknown) => void): void { this.listeners.get(type)?.delete(fn); }
    postMessage(msg: unknown): void { this.posted.push(msg); }
    terminate(): void { this.terminated = true; }
    emit(msg: ComprehensiveWorkerMessage): void {
      for (const fn of this.listeners.get("message") ?? []) fn({ data: msg });
    }
  }
  return { default: Stub };
});

const perms = vi.hoisted(() => ({ canExport: true, capabilityAllowed: true }));
vi.mock("../../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: (feature: string) => (feature === "export-reports" ? perms.canExport : true),
    getMutationCapability: () =>
      perms.capabilityAllowed ? { allowed: true, reason: null } : { allowed: false, reason: "feature-disabled" },
    role: "admin",
    username: "tester",
  }),
}));

const ws = vi.hoisted(() => ({ handle: null as unknown }));
vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: ws.handle, status: "ready" }),
}));

const openers = vi.hoisted(() => ({ openExecutiveReport: vi.fn(async () => {}), buildExecutiveXlsx: vi.fn(async () => {}) }));
vi.mock("../../../../../data/reporting/executiveReport", () => openers);
const deck = vi.hoisted(() => ({ openExecutiveDeckV2: vi.fn(async (..._a: unknown[]) => {}) }));
vi.mock("../../../../../data/reporting/executive/deck2", () => deck);
const styles = vi.hoisted(() => ({ loadDeckStyleChoices: vi.fn(async (_h: unknown): Promise<unknown> => null) }));
vi.mock("../../../../../data/reporting/executive/deck2/styleChoices", () => styles);
vi.mock("../../../../../data/audit/actionLog", () => ({ recordAction: vi.fn() }));

const storage = vi.hoisted(() => ({ listMonthFolders: vi.fn(async (_h: unknown): Promise<unknown[]> => []) }));
vi.mock("../../../../../data/population/populationStorage", () => storage);

const monthLoad = vi.hoisted(() => ({
  loadMonthExecInput: vi.fn(async (_h: unknown, _m: string): Promise<unknown> => null),
  buildExecutiveReportRows: vi.fn((_input: unknown): unknown[] => []),
}));
vi.mock("../../../../../data/reporting/loadMonthExecInput", () => ({ loadMonthExecInput: monthLoad.loadMonthExecInput }));
vi.mock("../../../../../data/reporting/executiveReportData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../data/reporting/executiveReportData")>()),
  buildExecutiveReportRows: monthLoad.buildExecutiveReportRows,
}));

import ComprehensiveExecutive from "./index";

const cells = {
  "معرف الأشعة": "30B8202512010003", "الشهر": "46023", "المستوى": "FORTH_STAGE",
  "نتيجة المستوى الأول": "اشتباه", "نتيجة المستوى الثاني": "سليمة", "صحة النتيجة": "سليمة",
  "الاكتمال": "مكتمل", "هل يوجد صورة؟": "نعم", "هل يوجد تحديد؟": "لا", "مستوى جودة الصورة": "عالي",
  "اسم المنفذ": "ميناء", "نوع المنفذ": "منفذ بحري", "رمز المنفذ": "30",
};

function doneMessage(): ComprehensiveWorkerMessage {
  const report = newMappingReport();
  const row = mapSampleRow(cells, "Q1_Sample", report)!;
  report.sheetsRead.push({ name: "Q1_Sample", rows: 1 });
  return { type: "done", rows: [row], report };
}

function selectFile(): void {
  const input = screen.getByTestId("ce-file-input");
  const file = new File(["x"], "study.xlsx");
  fireEvent.change(input, { target: { files: [file] } });
}

const L = getLabels();
const buttons = () => [L.ce_generate_deck, L.ce_generate_xlsx].map((n) => screen.getByRole("button", { name: n }));

beforeEach(() => {
  workers.length = 0;
  perms.canExport = true;
  perms.capabilityAllowed = true;
  ws.handle = createMemoryDirectory("root");
  openers.openExecutiveReport.mockClear();
  deck.openExecutiveDeckV2.mockClear();
  styles.loadDeckStyleChoices.mockReset();
  styles.loadDeckStyleChoices.mockImplementation(async () => null);
  openers.buildExecutiveXlsx.mockClear();
  monthLoad.loadMonthExecInput.mockReset();
  monthLoad.loadMonthExecInput.mockImplementation(async () => null);
  monthLoad.buildExecutiveReportRows.mockReset();
  monthLoad.buildExecutiveReportRows.mockImplementation(() => []);
  storage.listMonthFolders.mockReset();
  storage.listMonthFolders.mockImplementation(async () => []);
});
afterEach(cleanup);

describe("ComprehensiveExecutive page", () => {
  it("renders the title and, with no data and no file, shows the empty state with generate buttons disabled", async () => {
    render(<ComprehensiveExecutive />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(L.ce_title);
    expect(await screen.findByText(L.ce_empty)).toBeInTheDocument();
    for (const b of buttons()) expect(b).toBeDisabled();
  });

  it("reads a selected file: shows the workbook-read count and enables generation", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    expect(workers).toHaveLength(1);
    expect(screen.getByText(L.ce_reading)).toBeInTheDocument();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    expect(screen.getByTestId("ce-stat-wb-added")).toHaveTextContent("1");
    expect(screen.queryByText(L.ce_empty)).toBeNull();
    for (const b of buttons()) expect(b).toBeEnabled();
    expect(workers[0].terminated).toBe(true);
  });

  it("shows the NOSAMPLE message when the worker reports XQ-WB-NOSAMPLE", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit({ type: "error", code: "XQ-WB-NOSAMPLE", message: "no sheet" }));
    expect(await screen.findByText(L.ce_error_NOSAMPLE)).toBeInTheDocument();
  });

  it("falls back to the unknown-error message for an unrecognised code", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit({ type: "error", code: "XQ-WB-WEIRD", message: "?" }));
    expect(await screen.findByText(L.ce_error_UNKNOWN)).toBeInTheDocument();
  });

  it("keeps an already-read workbook when a data-refresh signal arrives", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    const before = storage.listMonthFolders.mock.calls.length;
    act(() => broadcastDataRefresh("manual"));
    await waitFor(() => expect(storage.listMonthFolders.mock.calls.length).toBe(before + 1));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1");
    expect(screen.getByText("study.xlsx")).toBeInTheDocument();
  });

  it("keeps workbook stats and generation when the system load fails, and shows the error", async () => {
    storage.listMonthFolders.mockImplementation(async () => { throw new Error("disk"); });
    render(<ComprehensiveExecutive />);
    expect(await screen.findByText(L.ce_system_load_failed)).toBeInTheDocument();
    for (const b of buttons()) expect(b).toBeDisabled();
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    expect(screen.getByText(L.ce_system_load_failed)).toBeInTheDocument();
    for (const b of buttons()) expect(b).toBeEnabled();
  });

  it("ignores a stale result from a removed file", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    fireEvent.click(screen.getByRole("button", { name: L.ce_remove_file }));
    expect(workers[0].terminated).toBe(true);
    act(() => workers[0].emit(doneMessage()));
    expect(screen.queryByTestId("ce-stat-wb-read")).toHaveTextContent("0");
    expect(screen.getByText(L.ce_empty)).toBeInTheDocument();
  });

  it("disables generation when the user lacks export-reports", async () => {
    perms.canExport = false;
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    for (const b of buttons()) expect(b).toBeDisabled();
  });

  it("generates the executive deck (not the detailed document) from the combined input, and the handler re-checks the mutation capability", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));

    perms.capabilityAllowed = false;
    fireEvent.click(screen.getByRole("button", { name: L.ce_generate_deck }));
    expect(await screen.findByText(L.msg_export_not_permitted)).toBeInTheDocument();
    expect(deck.openExecutiveDeckV2).not.toHaveBeenCalled();

    perms.capabilityAllowed = true;
    fireEvent.click(screen.getByRole("button", { name: L.ce_generate_deck }));
    await waitFor(() => expect(deck.openExecutiveDeckV2).toHaveBeenCalledTimes(1));
    const [input, names] = deck.openExecutiveDeckV2.mock.calls[0] as unknown as [{ monthFolderName: string }, Record<string, string>];
    expect(input.monthFolderName).toBe(COMPREHENSIVE_MONTH_LABEL);
    expect(names).toEqual({});
    expect(openers.openExecutiveReport).not.toHaveBeenCalled();
  });

  it("applies the workspace's saved deck style choices", async () => {
    styles.loadDeckStyleChoices.mockImplementation(async () => ({ choices: { "slide-cover": 2 } }));
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    fireEvent.click(screen.getByRole("button", { name: L.ce_generate_deck }));
    await waitFor(() => expect(deck.openExecutiveDeckV2).toHaveBeenCalledTimes(1));
    expect(deck.openExecutiveDeckV2.mock.calls[0][2]).toEqual({ "slide-cover": 2 });
  });

  it("keeps only completed rows per month and passes only template/config/stageMappings from the system base", async () => {
    const stageMappings = { x: "y" };
    storage.listMonthFolders.mockImplementation(async () => [{ folderName: "5-May-2026" }]);
    monthLoad.loadMonthExecInput.mockImplementation(async () => ({
      populationRows: [{ big: true }], template: null, config: { marker: "cfg" }, stageMappings,
    }));
    const row = (id: string, o: Record<string, unknown>) => ({ xrayImageId: id, selectedInSample: true, answerStatus: "submitted", imageAvailable: true, ...o });
    monthLoad.buildExecutiveReportRows.mockImplementation(() => [
      row("DONE", {}), row("DRAFT", { answerStatus: "draft" }), row("UNSAMPLED", { selectedInSample: false }),
    ]);
    render(<ComprehensiveExecutive />);
    await waitFor(() => expect(screen.getByTestId("ce-stat-system-completed")).toHaveTextContent("1"));
    expect(screen.getByTestId("ce-stat-total-rows")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: L.ce_generate_deck }));
    await waitFor(() => expect(deck.openExecutiveDeckV2).toHaveBeenCalledTimes(1));
    const [input] = deck.openExecutiveDeckV2.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(input.populationRows).toEqual([]);
    expect(input.config).toEqual({ marker: "cfg" });
    expect(input.stageMappings).toBe(stageMappings);
  });

  it("coalesces refresh signals that arrive while a load is in flight into one trailing load", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    storage.listMonthFolders.mockImplementation(async () => { await gate; return []; });
    render(<ComprehensiveExecutive />);
    await waitFor(() => expect(storage.listMonthFolders).toHaveBeenCalledTimes(1));
    act(() => { broadcastDataRefresh("manual"); broadcastDataRefresh("manual"); broadcastDataRefresh("manual"); });
    expect(storage.listMonthFolders).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(storage.listMonthFolders).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(storage.listMonthFolders).toHaveBeenCalledTimes(2);
  });

  it("generates without a mounted workspace (no audit record) when the workbook has rows", async () => {
    ws.handle = null;
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    fireEvent.click(screen.getByRole("button", { name: L.ce_generate_xlsx }));
    await waitFor(() => expect(openers.buildExecutiveXlsx).toHaveBeenCalledTimes(1));
    const { recordAction } = await import("../../../../../data/audit/actionLog");
    expect(recordAction).not.toHaveBeenCalled();
  });
});

describe("ComprehensiveExecutive data-source switch", () => {
  const radio = (name: string) => screen.getByRole("radio", { name });
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

  it("defaults to Excel + app data, in a named radiogroup, and loads the system months", async () => {
    render(<ComprehensiveExecutive />);
    expect(screen.getByRole("radiogroup", { name: L.ce_source_title })).toBeInTheDocument();
    expect(radio(L.ce_source_app_excel)).toBeChecked();
    expect(radio(L.ce_source_excel_only)).not.toBeChecked();
    await screen.findByText(L.ce_empty);
    expect(storage.listMonthFolders).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ce-stat-system-months")).toBeInTheDocument();
  });

  it("Excel only: no system loads (even on refresh), file required, then workbook-only stats", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    const loads = storage.listMonthFolders.mock.calls.length;
    fireEvent.click(radio(L.ce_source_excel_only));
    expect(await screen.findByText(L.ce_source_excel_only_hint)).toBeInTheDocument();
    expect(screen.queryByText(L.ce_empty)).toBeNull();
    for (const b of buttons()) expect(b).toBeDisabled();
    act(() => broadcastDataRefresh("manual"));
    await flush();
    expect(storage.listMonthFolders).toHaveBeenCalledTimes(loads);

    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    expect(screen.getByTestId("ce-stat-total-rows")).toHaveTextContent("1");
    expect(screen.queryByTestId("ce-stat-system-months")).toBeNull();
    expect(screen.queryByTestId("ce-stat-system-completed")).toBeNull();
    expect(screen.queryByTestId("ce-stat-dup-skipped")).toBeNull();
    expect(screen.getByTestId("ce-stats-mode")).toHaveTextContent(L.ce_source_excel_only);
    expect(screen.queryByTestId("ce-excel-only-hint")).toBeNull();
    for (const b of buttons()) expect(b).toBeEnabled();
    expect(storage.listMonthFolders).toHaveBeenCalledTimes(loads);
  });

  it("switching to Excel only and back keeps the workbook and reloads the system months", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));
    const loads = storage.listMonthFolders.mock.calls.length;

    fireEvent.click(radio(L.ce_source_excel_only));
    await flush();
    expect(screen.getByText("study.xlsx")).toBeInTheDocument();
    expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1");

    fireEvent.click(radio(L.ce_source_app_excel));
    await waitFor(() => expect(storage.listMonthFolders).toHaveBeenCalledTimes(loads + 1));
    await waitFor(() => expect(screen.getByTestId("ce-stat-system-months")).toBeInTheDocument());
    expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1");
    expect(screen.getByText("study.xlsx")).toBeInTheDocument();
    expect(workers).toHaveLength(1);
  });

  it("a mode switch during an in-flight load does not let the stale result win", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let call = 0;
    storage.listMonthFolders.mockImplementation(async () => {
      call++;
      if (call === 1) { await gate; return [{ folderName: "5-May-2026" }]; }
      return [];
    });
    monthLoad.loadMonthExecInput.mockImplementation(async () => ({ template: null, config: {}, stageMappings: undefined }));
    monthLoad.buildExecutiveReportRows.mockImplementation(() => [
      { xrayImageId: "STALE", selectedInSample: true, answerStatus: "submitted", imageAvailable: true },
    ]);
    render(<ComprehensiveExecutive />);
    await waitFor(() => expect(call).toBe(1));
    fireEvent.click(radio(L.ce_source_excel_only));
    fireEvent.click(radio(L.ce_source_app_excel));
    release();
    await waitFor(() => expect(call).toBe(2));
    await waitFor(() => expect(screen.getByTestId("ce-stat-system-months")).toHaveTextContent("0"));
    expect(screen.getByTestId("ce-stat-system-completed")).toHaveTextContent("0");
    expect(screen.getByText(L.ce_empty)).toBeInTheDocument();
  });
});
