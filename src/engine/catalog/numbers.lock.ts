/**
 * Published design numbers. Append-only: see the lock rule in registry.ts.
 * (A .ts const rather than numbers.lock.json because tsconfig does not enable resolveJsonModule.)
 */
export interface LockEntry {
  nameAr: string;
  slotIds: string[];
}

export const NUMBERS_LOCK: Record<number, LockEntry> = {
  1: { nameAr: "فاصل قسم", slotIds: ["heading", "description", "sourceNote"] },
  2: { nameAr: "شريط المؤشرات", slotIds: ["kpi1", "kpi2", "kpi3", "kpi4", "sourceNote"] },
  3: { nameAr: "مقارنة بالأعمدة", slotIds: ["category", "value", "sourceNote"] },
  4: { nameAr: "جدول تفصيلي", slotIds: ["row1", "row2", "value1", "value2", "value3", "rowOrder", "sourceNote"] },
  5: { nameAr: "مؤشرات مع مخطط", slotIds: ["kpi1", "kpi2", "kpi3", "category", "value", "sourceNote"] },
};
