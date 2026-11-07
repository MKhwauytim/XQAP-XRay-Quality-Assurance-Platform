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
  6: { nameAr: "مخطط مع ملاحظة", slotIds: ["category", "value", "panelTitle", "panelText", "sourceNote"] },
  7: { nameAr: "الأعلى ترتيبًا", slotIds: ["category", "value", "sourceNote"] },
  8: { nameAr: "مؤشرات مع جدول", slotIds: ["kpi1", "kpi2", "kpi3", "row1", "value1", "value2", "value3", "rowOrder", "sourceNote"] },
  9: { nameAr: "تعريفات المصطلحات", slotIds: ["term1", "definition1", "term2", "definition2", "term3", "definition3", "term4", "definition4", "term5", "definition5", "term6", "definition6", "sourceNote"] },
  10: { nameAr: "الغلاف", slotIds: ["kicker", "heading", "periodLabel", "periodValue", "meta1", "meta2", "meta3"] },
  11: { nameAr: "المحتويات", slotIds: ["heading", "sourceNote"] },
  12: { nameAr: "أعمدة مجمعة", slotIds: ["category", "valueA", "valueB", "categoryOrder", "sourceNote"] },
  13: { nameAr: "مصفوفة الجودة", slotIds: ["rowGroup", "columnGroup", "rate", "stat1", "stat2", "sourceNote"] },
  14: { nameAr: "جدول الملاحظات", slotIds: ["observation", "recommendation", "figure1", "figure2", "rowOrder", "sourceNote"] },
  15: { nameAr: "تعريف المستوى", slotIds: ["level", "subtitle", "definition", "determinant", "weight", "highlight", "highlightNote", "sourceNote"] },
  16: { nameAr: "الاتجاه الشهري", slotIds: ["period", "value", "series", "periodOrder", "sourceNote"] },
  17: { nameAr: "الختام وبيانات الجهة", slotIds: ["kicker", "heading", "closingLine", "meta1", "meta2", "meta3"] },
};
