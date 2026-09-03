/**
 * Arabic display overrides for `LATEST_UPDATES` (latestUpdates.generated.ts).
 *
 * Edit-log entries are written in English per CLAUDE.md convention, but the
 * "سجل التحديثات" tab is Arabic-only UI. Rather than hand-editing the
 * auto-generated data file (which would be overwritten on the next
 * `npm run generate:changelog`), each shown entry's title/scope is mapped
 * here by version. An entry with no mapping falls back to its raw
 * (English) title/scope so the page never silently drops content.
 */

/** Arabic title override, keyed by `ChangelogEntry.version`. */
export const TITLE_TRANSLATIONS: Record<string, string> = {
  "v131.11": "ترجمة عناوين ونطاقات التحديثات المعروضة إلى العربية",
  "v131.10":
    "ضمان حصول الموظف المقيَّد بميناء واحد على كامل طاقته المتاحة بدلاً من تقسيمها حسب الحاجة الأولية",
  "v131.9":
    "الحفاظ على تساوي إجمالي العينات لكل موظف عند تفعيل قيود الموانئ",
  "v131.8":
    "عدم فقدان مستخدم مُضاف أو مُعدَّل حديثًا عند إعادة تحميل الصفحة قبل اكتمال حفظه على القرص",
  "v131.6":
    "إيقاف التحديث الدوري لشاشة النتائج عن إعادة قراءة الشهر بالكامل في كل دورة",
  "v131.5":
    "نقل أدوات التصحيح (Debug) من جلسة العرض التجريبي إلى حساب المسؤول",
  "v131.4":
    "تبويب سجل التحديثات — يعرض أحدث 10 تحديثات، يُنشأ وقت البناء من سجلات التعديلات",
  "v131.3":
    "إزالة تبويب أوراق العمل، وإضافة رسالة اعتماد في أدوات المطوّر (DevTools)، وإضافة سؤال نوع الاشتباه",
  "v131.2": "دمج صفحتَي سجل النشاط وسجل الإجراءات في صفحة واحدة",
  "v131.1":
    "إيقاف تراكب فجوات عدة أيام في صف واحد لساعات العمل بوضع الفريق",
  "v131.0": "إزالة إعدادات نمط أسماء الأوراق القديمة من إعدادات معالجة البيانات",
};

/** Arabic label override for an entry's `scope` slug. */
export const SCOPE_TRANSLATIONS: Record<string, string> = {
  "user-management": "إدارة المستخدمين",
  "employee-workspace": "إدارة مساحة العمل",
  auth: "المصادقة",
  changelog: "سجل التحديثات",
  performance: "الأداء",
  population: "إدارة بيانات الأشعة",
  distribution: "التوزيع",
};

export function translateTitle(version: string, title: string): string {
  return TITLE_TRANSLATIONS[version] ?? title;
}

export function translateScope(scope: string | null): string | null {
  if (!scope) return scope;
  return SCOPE_TRANSLATIONS[scope] ?? scope;
}
