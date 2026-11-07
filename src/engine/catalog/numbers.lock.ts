/**
 * Published design numbers. Append-only: see the lock rule in registry.ts.
 * (A .ts const rather than numbers.lock.json because tsconfig does not enable resolveJsonModule.)
 */
export interface LockEntry {
  nameAr: string;
  /** Frozen once the design is active or retired; absent while planned, whose slots are provisional. */
  slotIds?: string[];
}

export const NUMBERS_LOCK: Record<number, LockEntry> = {
  1: { nameAr: "فاصل قسم", slotIds: ["heading", "description", "sourceNote"] },
  2: { nameAr: "شريط المؤشرات", slotIds: ["kpi1", "kpi2", "kpi3", "kpi4", "sourceNote"] },
  3: { nameAr: "مقارنة بالأعمدة", slotIds: ["category", "value", "sourceNote"] },
  4: { nameAr: "جدول تفصيلي", slotIds: ["row1", "row2", "value1", "value2", "value3", "rowOrder", "sourceNote"] },
  5: { nameAr: "مؤشرات مع مخطط", slotIds: ["kpi1", "kpi2", "kpi3", "category", "value", "sourceNote"] },
  6: { nameAr: "مخطط مع ملاحظة", slotIds: ["category", "value", "panelTitle", "panelText", "sourceNote"] },
  7: { nameAr: "الأعلى ترتيبًا", slotIds: ["category", "value", "sourceNote"] },
  8: { nameAr: "مؤشرات مع جدول", slotIds: ["kpi1", "kpi2", "kpi3", "row1", "value1", "value2", "value3", "rowOrder", "sourceNote"] },
  9: { nameAr: "تعريفات المصطلحات", slotIds: ["term1", "definition1", "term2", "definition2", "term3", "definition3", "term4", "definition4", "term5", "definition5", "term6", "definition6", "sourceNote"] },
  10: { nameAr: "الغلاف" },
  11: { nameAr: "المحتويات" },
  12: { nameAr: "أعمدة مجمعة" },
  13: { nameAr: "مصفوفة الجودة" },
  14: { nameAr: "جدول الملاحظات" },
  15: { nameAr: "تعريف المستوى" },
  16: { nameAr: "الاتجاه الشهري" },
  17: { nameAr: "الختام وبيانات الجهة" },
};
