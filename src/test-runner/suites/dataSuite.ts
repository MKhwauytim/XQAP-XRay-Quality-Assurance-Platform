import {
  normalizeDate,
  normalizeResultValue,
} from "../../components/Sidebar/Tabs/Population/processing/populationProcessor";
import { expect, type TestSuite } from "../runner";

export const dataSuite: TestSuite = {
  name: "Data Normalization",
  tests: [
    // ── normalizeDate: null / empty / dash ────────────────────────────────────
    {
      name: "null input returns null",
      fn() { expect(normalizeDate(null)).toBeNull(); },
    },
    {
      name: "empty string returns null",
      fn() { expect(normalizeDate("")).toBeNull(); },
    },
    {
      name: "dash '-' returns null",
      fn() {
        const r = normalizeDate("-");
        // Should not parse as a valid ISO date
        if (r && /^\d{4}-\d{2}-\d{2}$/.test(r)) throw new Error(`Dash incorrectly parsed to ${r}`);
      },
    },
    {
      name: "dot '.' returns null-or-raw (not a valid date)",
      fn() {
        const r = normalizeDate(".");
        if (r && /^\d{4}-\d{2}-\d{2}$/.test(r)) throw new Error(`Dot incorrectly parsed to ${r}`);
      },
    },

    // ── normalizeDate: ISO passthrough ────────────────────────────────────────
    {
      name: "ISO date passes through unchanged",
      fn() { expect(normalizeDate("2025-06-12")).toBe("2025-06-12"); },
    },
    {
      name: "ISO datetime extracts date portion",
      fn() {
        const r = normalizeDate("2025-06-12T09:30:00");
        expect(r).toBe("2025-06-12");
      },
    },

    // ── normalizeDate: DD/MM/YYYY ─────────────────────────────────────────────
    {
      name: "DD/MM/YYYY parses correctly",
      fn() { expect(normalizeDate("12/06/2025")).toBe("2025-06-12"); },
    },
    {
      name: "D/M/YYYY (single digit) parses correctly",
      fn() { expect(normalizeDate("1/6/2025")).toBe("2025-06-01"); },
    },
    {
      name: "DD-MM-YYYY parses correctly",
      fn() { expect(normalizeDate("12-06-2025")).toBe("2025-06-12"); },
    },
    {
      name: "DD.MM.YYYY parses correctly",
      fn() { expect(normalizeDate("12.06.2025")).toBe("2025-06-12"); },
    },

    // ── normalizeDate: English month names ────────────────────────────────────
    {
      name: "12Dec2025 parses correctly",
      fn() { expect(normalizeDate("12Dec2025")).toBe("2025-12-12"); },
    },
    {
      name: "12dec2025 (lowercase) parses correctly",
      fn() { expect(normalizeDate("12dec2025")).toBe("2025-12-12"); },
    },
    {
      name: "12Jan2025 parses correctly",
      fn() { expect(normalizeDate("12Jan2025")).toBe("2025-01-12"); },
    },
    {
      name: "12/Dec/2025 with separators parses correctly",
      fn() { expect(normalizeDate("12/Dec/2025")).toBe("2025-12-12"); },
    },

    // ── normalizeDate: Arabic month names ────────────────────────────────────
    {
      name: "Arabic 'ديسمبر' parses correctly",
      fn() { expect(normalizeDate("12 ديسمبر 2025")).toBe("2025-12-12"); },
    },
    {
      name: "Arabic 'يناير' parses correctly",
      fn() { expect(normalizeDate("1 يناير 2025")).toBe("2025-01-01"); },
    },
    {
      name: "Arabic 'يونيو' parses correctly",
      fn() { expect(normalizeDate("15 يونيو 2025")).toBe("2025-06-15"); },
    },

    // ── normalizeDate: Excel serial ───────────────────────────────────────────
    {
      name: "Excel serial 45474 converts to valid ISO date",
      fn() {
        // 45474 = 2024-06-12 approx
        const r = normalizeDate("45474");
        if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r)) throw new Error(`Excel serial produced invalid: ${r}`);
        expect(r.startsWith("2024")).toBe(true);
      },
    },
    {
      name: "Excel serial 47923 converts to valid ISO date",
      fn() {
        const r = normalizeDate("47923");
        if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r)) throw new Error(`Excel serial produced invalid: ${r}`);
      },
    },
    {
      name: "small number is NOT treated as Excel serial",
      fn() {
        // Numbers < 25000 shouldn't be treated as dates
        const r = normalizeDate("1234");
        if (r && /^\d{4}-\d{2}-\d{2}$/.test(r)) throw new Error(`Small number wrongly treated as date: ${r}`);
      },
    },

    // ── normalizeResultValue ──────────────────────────────────────────────────
    {
      name: "null returns null",
      fn() { expect(normalizeResultValue(null)).toBeNull(); },
    },
    {
      name: "'1' maps to سليمة",
      fn() { expect(normalizeResultValue("1")).toBe("سليمة"); },
    },
    {
      name: "'2' maps to اشتباه",
      fn() { expect(normalizeResultValue("2")).toBe("اشتباه"); },
    },
    {
      name: "'سليمة - 123' maps to سليمة (BI format)",
      fn() { expect(normalizeResultValue("سليمة - 123")).toBe("سليمة"); },
    },
    {
      name: "'اشتباه - risk' maps to اشتباه (BI format)",
      fn() { expect(normalizeResultValue("اشتباه - risk")).toBe("اشتباه"); },
    },
    {
      name: "'CLEAR' maps to سليمة",
      fn() { expect(normalizeResultValue("CLEAR")).toBe("سليمة"); },
    },
    {
      name: "'OK' maps to سليمة",
      fn() { expect(normalizeResultValue("OK")).toBe("سليمة"); },
    },
    {
      name: "'PASS' maps to سليمة",
      fn() { expect(normalizeResultValue("PASS")).toBe("سليمة"); },
    },
    {
      name: "'ALERT' maps to اشتباه",
      fn() { expect(normalizeResultValue("ALERT")).toBe("اشتباه"); },
    },
    {
      name: "'FAIL' maps to اشتباه",
      fn() { expect(normalizeResultValue("FAIL")).toBe("اشتباه"); },
    },
    {
      name: "'SUSPECT' maps to اشتباه",
      fn() { expect(normalizeResultValue("SUSPECT")).toBe("اشتباه"); },
    },
    {
      name: "'نظيف' (Arabic synonym) maps to سليمة",
      fn() { expect(normalizeResultValue("نظيف")).toBe("سليمة"); },
    },
    {
      name: "'مقبول' (Arabic synonym) maps to سليمة",
      fn() { expect(normalizeResultValue("مقبول")).toBe("سليمة"); },
    },
    {
      name: "'مريب' (Arabic synonym) maps to اشتباه",
      fn() { expect(normalizeResultValue("مريب")).toBe("اشتباه"); },
    },
    {
      name: "'مشبوه' (Arabic synonym) maps to اشتباه",
      fn() { expect(normalizeResultValue("مشبوه")).toBe("اشتباه"); },
    },
    {
      name: "unknown string returns null",
      fn() { expect(normalizeResultValue("xyz")).toBeNull(); },
    },
    {
      name: "'3' (invalid level) returns null",
      fn() { expect(normalizeResultValue("3")).toBeNull(); },
    },
  ],
};
