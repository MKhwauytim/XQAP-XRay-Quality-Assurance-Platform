/* eslint-disable react-refresh/only-export-components */
import { useState, useCallback } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BarChart2,
  Check,
  ChevronRight,
  Columns,
  FileText,
  MessageSquare,
  PanelLeft,
  PieChart,
  RotateCcw,
  Scan,
  Settings,
  Table,
  Tag,
  TrendingUp,
} from "lucide-react";
import {
  DEFAULT_LABELS,
  getLabels,
  isCustomized,
  resetAllLabels,
  resetLabel,
  setLabel,
  type LabelKey,
} from "../../../../data/labels/labelsStore";
import { useLabels } from "../../../../data/labels/useLabels";
import type { SidebarTabModule } from "../tabTypes";
import "./Settings.css";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import { ErrorLogSection } from "./ErrorLogSection";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id:           "settings",
  label:        "إدارة الإعدادات",
  order:        95,
  allowedRoles: ["guest", "admin"],
  icon:         <Settings size={20} strokeWidth={1.8} aria-hidden />,
};

// ── label groups ──────────────────────────────────────────────────────────────

type LabelGroup = {
  icon:  ReactNode;
  title: string;
  keys:  { key: LabelKey; desc: string }[];
};

const LABEL_GROUPS: LabelGroup[] = [
  {
    icon:  <PanelLeft size={18} />,
    title: "القائمة الجانبية",
    keys: [
      { key: "sidebar_title",    desc: "عنوان القائمة الجانبية" },
      { key: "sidebar_subtitle", desc: "العنوان الفرعي للقائمة" },
    ],
  },
  {
    icon:  <FileText size={18} />,
    title: "عناوين الصفحات",
    keys: [
      { key: "page_settings_eyebrow",         desc: "النص العلوي لصفحة الإعدادات" },
      { key: "page_settings_title",           desc: "عنوان صفحة الإعدادات" },
      { key: "page_settings_subtitle",        desc: "وصف صفحة الإعدادات" },
      { key: "page_xray_referrals_eyebrow",   desc: "النص العلوي لصفحة صور الأشعة المحالة" },
      { key: "page_xray_referrals_title",     desc: "عنوان صفحة صور الأشعة المحالة" },
      { key: "page_xray_referrals_subtitle_own", desc: "وصف صور الأشعة المحالة للموظف" },
      { key: "page_xray_referrals_subtitle_all", desc: "وصف صور الأشعة المحالة للمشرف أو المدير" },
      { key: "page_xray_results_eyebrow",     desc: "النص العلوي لصفحة نتائج فحص الأشعة" },
      { key: "page_xray_results_title",       desc: "عنوان صفحة نتائج فحص الأشعة" },
      { key: "page_xray_results_subtitle",    desc: "وصف صفحة نتائج فحص الأشعة" },
    ],
  },
  {
    icon:  <Table size={18} />,
    title: "أدوات الجداول",
    keys: [
      { key: "dt_search_placeholder",  desc: "نص البحث في الجداول" },
      { key: "dt_clear_filters",       desc: "زر مسح التصفية" },
      { key: "dt_export_xlsx",         desc: "زر تصدير Excel" },
      { key: "dt_columns_button",      desc: "زر الأعمدة" },
      { key: "dt_columns_title",       desc: "عنوان قائمة الأعمدة" },
      { key: "dt_columns_hint",        desc: "تعليمات قائمة الأعمدة" },
      { key: "dt_reset_default",       desc: "زر إعادة الافتراضي للأعمدة" },
      { key: "dt_done",                desc: "زر تم" },
      { key: "dt_row_suffix",          desc: "لاحقة عدد الصفوف" },
      { key: "dt_filter_clear",        desc: "مسح فلتر العمود" },
      { key: "dt_filter_empty",        desc: "رسالة عدم وجود قيم في الفلتر" },
      { key: "dt_filter_search",       desc: "نص البحث داخل الفلتر" },
      { key: "dt_filter_apply",        desc: "زر تطبيق الفلتر" },
      { key: "dt_filter_specific_day", desc: "خيار يوم محدد" },
      { key: "dt_filter_range",        desc: "خيار نطاق تاريخ" },
      { key: "dt_filter_from",         desc: "حقل من" },
      { key: "dt_filter_to",           desc: "حقل إلى" },
      { key: "dt_date_badge",          desc: "شارة التاريخ في قائمة الأعمدة" },
      { key: "dt_show_column",         desc: "تلميح إظهار العمود" },
      { key: "dt_hide_column",         desc: "تلميح إخفاء العمود" },
    ],
  },
  {
    icon:  <Columns size={18} />,
    title: "أعمدة جداول الأشعة",
    keys: [
      { key: "col_xray_image_id",             desc: "عمود معرف الأشعة" },
      { key: "col_stage",                     desc: "عمود المستوى" },
      { key: "col_xray_quality_expert",       desc: "عمود خبير جودة الأشعة" },
      { key: "col_port_name",                 desc: "عمود المنفذ" },
      { key: "col_xray_entry_date",           desc: "عمود تاريخ دخول صورة الأشعة" },
      { key: "col_distribution_date",         desc: "عمود تاريخ التوزيع" },
      { key: "col_plate_or_container_number", desc: "عمود لوحة / حاوية" },
      { key: "col_answer_status",             desc: "عمود الحالة" },
      { key: "col_xray_l1_result",            desc: "عمود نتيجة L1" },
      { key: "col_xray_l2_result",            desc: "عمود نتيجة L2" },
      { key: "col_certscan_status",           desc: "عمود CertScan" },
      { key: "col_declaration_number",        desc: "عمود رقم البيان" },
      { key: "col_declaration_date",          desc: "عمود تاريخ البيان" },
      { key: "col_chassis_number",            desc: "عمود رقم الهيكل" },
      { key: "col_movement_type",             desc: "عمود نوع الحركة" },
      { key: "col_port_code",                 desc: "عمود كود المنفذ" },
      { key: "col_port_type",                 desc: "عمود نوع المنفذ" },
      { key: "col_targeted_by_risk",          desc: "عمود مستهدف بالمخاطر" },
      { key: "col_risk_message",              desc: "عمود رسالة المخاطر" },
      { key: "col_bi_enrichment_status",      desc: "عمود حالة BI" },
      { key: "col_report_number",             desc: "عمود رقم التقرير" },
    ],
  },
  {
    icon:  <MessageSquare size={18} />,
    title: "الحالات والرسائل",
    keys: [
      { key: "status_all",             desc: "خيار كل الحالات" },
      { key: "status_completed",       desc: "حالة مكتملة" },
      { key: "status_submitted",       desc: "حالة مقدمة" },
      { key: "status_draft",           desc: "حالة مسودة" },
      { key: "status_pending",         desc: "حالة لم تبدأ" },
      { key: "status_replaced",        desc: "حالة مستبدلة" },
      { key: "value_empty",            desc: "قيمة فارغة" },
      { key: "label_month",            desc: "تسمية حقل الشهر" },
      { key: "label_template",         desc: "تسمية حقل النموذج" },
      { key: "xray_results_loading",   desc: "رسالة تحميل نتائج الفحص" },
      { key: "xray_results_error",     desc: "رسالة خطأ نتائج الفحص" },
      { key: "xray_results_no_months", desc: "رسالة عدم وجود أشهر" },
      { key: "xray_results_no_rows",   desc: "رسالة عدم وجود نتائج" },
    ],
  },
  {
    icon:  <BarChart2 size={18} />,
    title: "مؤشرات الأداء (KPIs)",
    keys: [
      { key: "kpi_population",      desc: "إجمالي المجتمع" },
      { key: "kpi_sample",          desc: "إجمالي العينة" },
      { key: "kpi_completed",       desc: "المعالجة / المدروسة" },
      { key: "kpi_completion_rate", desc: "نسبة الإنجاز" },
      { key: "kpi_pending",         desc: "قيد الانتظار" },
      { key: "kpi_months",          desc: "عدد الأشهر المعالجة" },
    ],
  },
  {
    icon:  <Tag size={18} />,
    title: "أسماء المستويات",
    keys: [
      { key: "stage_first",   desc: "المستوى الأول" },
      { key: "stage_second",  desc: "المستوى الثاني" },
      { key: "stage_third",   desc: "المستوى الثالث" },
      { key: "stage_fourth",  desc: "المستوى الرابع" },
      { key: "stage_unknown", desc: "المستوى غير المحدد" },
    ],
  },
  {
    icon:  <Scan size={18} />,
    title: "نظام الأشعة (CertScan)",
    keys: [
      { key: "certscan_name",    desc: "اسم نظام الأشعة المركزية" },
      { key: "noncertscan_name", desc: "اسم الأشعة غير المركزية" },
    ],
  },
  {
    icon:  <PieChart size={18} />,
    title: "رسوم التقرير التنفيذي",
    keys: [
      { key: "exec_report_title",        desc: "عنوان التقرير التنفيذي" },
      { key: "exec_chart_port",          desc: "رسم توزيع المجتمع حسب المنفذ" },
      { key: "exec_chart_daily",         desc: "رسم التوزيع اليومي للصور" },
      { key: "exec_chart_stage",         desc: "رسم توزيع المستويات" },
      { key: "exec_chart_stage_summary", desc: "جدول ملخص المستويات" },
    ],
  },
  {
    icon:  <TrendingUp size={18} />,
    title: "رسوم النظرة العامة",
    keys: [
      { key: "ov_chart_trend",         desc: "رسم اتجاه المجتمع والعينة والإنجاز" },
      { key: "ov_chart_certscan",      desc: "رسم توزيع نظام الأشعة المركزية" },
      { key: "ov_chart_dist_status",   desc: "رسم حالة التوزيع" },
      { key: "ov_chart_stage_month",   desc: "رسم المستويات حسب الشهر" },
      { key: "ov_chart_rates",         desc: "رسم نسب العينة والإنجاز" },
      { key: "ov_chart_top_ports",     desc: "رسم أعلى المنافذ" },
      { key: "ov_chart_month_summary", desc: "جدول ملخص الأشهر" },
    ],
  },
];

// ── row component ─────────────────────────────────────────────────────────────

function LabelRow({ labelKey, desc }: { labelKey: LabelKey; desc: string }) {
  const current = getLabels()[labelKey];
  const custom  = isCustomized(labelKey);
  const [val, setVal] = useState<string>(current);
  const [saved, setSaved] = useState(false);

  const save = useCallback(() => {
    setLabel(labelKey, val);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [labelKey, val]);

  const reset = useCallback(() => {
    resetLabel(labelKey);
    setVal(DEFAULT_LABELS[labelKey]);
  }, [labelKey]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") { setVal(getLabels()[labelKey]); }
  };

  return (
    <div className={`settings-label-row${custom ? " is-custom" : ""}`}>
      {/* Column 1: description + key + default */}
      <div className="settings-label-meta">
        <span className="settings-label-desc">{desc}</span>
        <span className="settings-label-key">{labelKey}</span>
        {custom && (
          <span className="settings-label-default">
            الافتراضي: {DEFAULT_LABELS[labelKey]}
          </span>
        )}
      </div>
      {/* Column 2: input + saved badge + reset */}
      <div className="settings-label-control">
        <input
          type="text"
          className={`settings-label-input${custom ? " is-custom" : ""}`}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={handleKey}
          dir="rtl"
        />
        {saved && <span className="settings-saved-badge"><Check size={12} style={{ verticalAlign: "middle", marginInlineEnd: 3 }} /> تم</span>}
        <button
          type="button"
          className="settings-reset-btn"
          onClick={reset}
          disabled={!custom}
          title="استعادة القيمة الافتراضية"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}

// ── settings page ─────────────────────────────────────────────────────────────

function SettingsPage() {
  useLabels(); // re-render when any label changes
  const [confirmReset, setConfirmReset] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());

  function handleResetAll() {
    if (!confirmReset) { setConfirmReset(true); return; }
    resetAllLabels();
    setConfirmReset(false);
  }

  function toggleSection(title: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  const customCount = (Object.keys(DEFAULT_LABELS) as LabelKey[]).filter(isCustomized).length;

  return (
    <div className="settings-root">
      <div className="settings-root-inner">
        <PageHeader
          eyebrow={getLabels().page_settings_eyebrow}
          title={getLabels().page_settings_title}
          subtitle={getLabels().page_settings_subtitle}
        >
          {customCount > 0 && (
            <button
              type="button"
              className="settings-reset-all-btn"
              onClick={handleResetAll}
            >
              {confirmReset ? <><AlertTriangle size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> تأكيد الاستعادة؟</> : <><RotateCcw size={13} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> استعادة الكل ({customCount} تعديل)</>}
            </button>
          )}
        </PageHeader>
      </div>

      <div className="settings-category">
        <div className="settings-category-header">
          <span className="settings-category-icon"><Tag size={20} /></span>
          <div>
            <h2 className="settings-category-title">التسميات والعناوين</h2>
            <p className="settings-category-desc">تعديل نصوص الواجهة وعناوين الصفحات والأعمدة والأزرار</p>
          </div>
          {customCount > 0 && (
            <span className="settings-category-badge">{customCount} معدّل</span>
          )}
        </div>

        <div className="settings-category-body">
          {LABEL_GROUPS.map((group) => {
            const isOpen = openSections.has(group.title);
            const groupCustomCount = group.keys.filter((k) => isCustomized(k.key)).length;
            return (
              <div key={group.title} className={`settings-section${isOpen ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="settings-section-header"
                  onClick={() => toggleSection(group.title)}
                  aria-expanded={isOpen}
                >
                  <span className="settings-section-icon">{group.icon}</span>
                  <h3 className="settings-section-title">{group.title}</h3>
                  <span className="settings-section-meta">
                    <span className="settings-section-count-items">{group.keys.length} حقل</span>
                    {groupCustomCount > 0 && (
                      <span className="settings-section-count">{groupCustomCount} معدّل</span>
                    )}
                  </span>
                  <span className={`settings-section-chevron${isOpen ? " open" : ""}`}><ChevronRight size={14} /></span>
                </button>
                {isOpen && (
                  <div className="settings-section-body">
                    {group.keys.map(({ key, desc }) => (
                      <LabelRow key={key} labelKey={key} desc={desc} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ErrorLogSection />
    </div>
  );
}

export default SettingsPage;
