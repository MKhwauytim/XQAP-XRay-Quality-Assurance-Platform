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
vi.mock("../../../../../data/audit/actionLog", () => ({ recordAction: vi.fn() }));

const storage = vi.hoisted(() => ({ listMonthFolders: vi.fn(async (_h: unknown): Promise<unknown[]> => []) }));
vi.mock("../../../../../data/population/populationStorage", () => storage);

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
const buttons = () => [L.ce_generate_doc, L.ce_generate_deck2, L.ce_generate_xlsx].map((n) => screen.getByRole("button", { name: n }));

beforeEach(() => {
  workers.length = 0;
  perms.canExport = true;
  perms.capabilityAllowed = true;
  ws.handle = createMemoryDirectory("root");
  openers.openExecutiveReport.mockClear();
  openers.buildExecutiveXlsx.mockClear();
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

  it("generates the document from the combined input, and the handler re-checks the mutation capability", async () => {
    render(<ComprehensiveExecutive />);
    await screen.findByText(L.ce_empty);
    selectFile();
    act(() => workers[0].emit(doneMessage()));
    await waitFor(() => expect(screen.getByTestId("ce-stat-wb-read")).toHaveTextContent("1"));

    perms.capabilityAllowed = false;
    fireEvent.click(screen.getByRole("button", { name: L.ce_generate_doc }));
    expect(await screen.findByText(L.msg_export_not_permitted)).toBeInTheDocument();
    expect(openers.openExecutiveReport).not.toHaveBeenCalled();

    perms.capabilityAllowed = true;
    fireEvent.click(screen.getByRole("button", { name: L.ce_generate_doc }));
    await waitFor(() => expect(openers.openExecutiveReport).toHaveBeenCalledTimes(1));
    const [input, names] = openers.openExecutiveReport.mock.calls[0] as unknown as [{ monthFolderName: string }, Record<string, string>];
    expect(input.monthFolderName).toBe(COMPREHENSIVE_MONTH_LABEL);
    expect(names).toEqual({});
  });
});
