import type { Locator, Page } from "@playwright/test";
import { workspace } from "./app";

/**
 * "This sub-tab's content is on screen" locators, passed to `openSubTab`.
 *
 * Each one is something ONLY that section renders, so it cannot be satisfied
 * by the parent tab's shared header (which several sections share verbatim) or
 * by the sibling section the app falls back to when a sub-tab click is dropped.
 */

export const BROWSE_READY = (page: Page): Locator =>
  workspace(page).getByRole("button", { name: "المجتمع النهائي" });

export const PROCESS_READY = (page: Page): Locator =>
  workspace(page).getByRole("navigation", { name: "مراحل معالجة المجتمع" });

export const ADHOC_READY = (page: Page): Locator =>
  workspace(page).getByRole("heading", { name: "ارفاق حالات استثنائية", level: 1 });

export const REFERRALS_READY = (page: Page): Locator =>
  workspace(page).getByRole("heading", { name: "صور الأشعة المحالة", level: 1 });

export const RESULTS_READY = (page: Page): Locator =>
  workspace(page).getByRole("heading", { name: "نتائج فحص الأشعة", level: 1 });

export const APPROVALS_READY = (page: Page): Locator =>
  workspace(page).getByRole("heading", { name: "اعتماد الطلبات", level: 1 });

export const USERS_READY = (page: Page): Locator =>
  workspace(page).getByRole("searchbox", { name: "ابحث باسم المستخدم أو الاسم الظاهر…" });

export const PAGE_MATRIX_READY = (page: Page): Locator =>
  workspace(page).getByRole("button", { name: "ضيف: population - لا وصول" });

export const FEATURE_MATRIX_READY = (page: Page): Locator =>
  workspace(page).getByRole("button", { name: "معالجة المجتمع", exact: true });

export const ACTIVITY_READY = (page: Page): Locator =>
  workspace(page).getByText("5-system/audit/activity/", { exact: false });

export const ACTIONS_READY = (page: Page): Locator =>
  workspace(page).getByText("5-system/audit/actions/", { exact: false });
