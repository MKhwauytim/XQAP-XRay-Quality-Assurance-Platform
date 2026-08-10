import { Info } from "lucide-react";
import { useLabels } from "../../../../data/labels/useLabels";

/**
 * Small "About" card showing the running app version. `__APP_VERSION__` is injected at build
 * time from `package.json` via Vite's `define` (see vite.config.ts / vitest.config.ts) — this
 * is the single source of truth, there is no separately hand-maintained version string.
 *
 * Also carries author attribution (design spec §5.2, manifest-and-storage-correctness):
 * the web app manifest spec has no author member, so attribution to محمد الخويتم
 * (Mkhuwaytim) — also present as `<meta name="author">` in index.html — is shown here.
 */
export function AboutSection() {
  const labels = useLabels();
  return (
    <div className="settings-category" dir="rtl">
      <div className="settings-category-header">
        <span className="settings-category-icon"><Info size={20} /></span>
        <div>
          <h2 className="settings-category-title">حول النظام</h2>
          <p className="settings-category-desc">إصدار التطبيق الحالي وسجل التغييرات</p>
        </div>
      </div>
      <div className="settings-category-body">
        <p className="settings-about-row">
          الإصدار: <span className="settings-about-version">{__APP_VERSION__}</span>
        </p>
        <p className="settings-about-row">
          {labels.about_author_label}: <span className="settings-about-version">{labels.about_author_name}</span>
        </p>
        <p className="settings-about-row settings-about-note">
          للاطلاع على سجل كامل بجميع الإصدارات والتعديلات، راجع تبويب «سجل الإصدارات».
        </p>
      </div>
    </div>
  );
}
