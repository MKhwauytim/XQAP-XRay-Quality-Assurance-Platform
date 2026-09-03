/* eslint-disable react-refresh/only-export-components */
import { History } from "lucide-react";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { usePermissions } from "../../../../auth/usePermissions";
import { AccessDenied } from "../../../PermissionGuard";
import { PageHeader } from "../../../PageHeader/PageHeader";
import { EmptyState } from "../../../StateViews/StateViews";
import { getLabels } from "../../../../data/labels/labelsStore";
import { LATEST_UPDATES } from "../../../../data/changelog/latestUpdates.generated";
import { translateScope, translateTitle } from "../../../../data/changelog/titleTranslations";
import type { ChangelogBucket, ChangelogEntry } from "../../../../data/changelog/changelogTypes";
import type { SidebarTabModule } from "../tabTypes";
import "./Changelog.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "changelog",
  label: "سجل التحديثات",
  order: 90,
  allowedRoles: tabAllowedRoles("changelog"),
  icon: <History size={20} strokeWidth={1.8} aria-hidden />,
};

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function formatArabicDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = ARABIC_MONTHS[(month ?? 1) - 1] ?? isoDate;
  return `${day} ${monthName} ${year}`;
}

// Reuses the app-wide .ui-badge variants (primitives.css) rather than introducing new
// colors, per CLAUDE.md's "no duplicate state" rule (B4 also forbids raw hex literals).
const BUCKET_BADGE_CLASS: Record<ChangelogBucket, string> = {
  fix: "ui-badge--danger",
  feature: "ui-badge--success",
  enhancement: "ui-badge--warning",
  redesign: "ui-badge--info",
};

function bucketLabel(bucket: ChangelogBucket): string {
  const labels = getLabels();
  switch (bucket) {
    case "fix": return labels.changelog_bucket_fix;
    case "feature": return labels.changelog_bucket_feature;
    case "enhancement": return labels.changelog_bucket_enhancement;
    case "redesign": return labels.changelog_bucket_redesign;
  }
}

function ChangelogRow({ entry }: { entry: ChangelogEntry }) {
  const scope = translateScope(entry.scope);
  const title = translateTitle(entry.version, entry.title);
  return (
    <li className="chg-row ui-card">
      <div className="chg-row-top">
        <span className={`ui-badge ${BUCKET_BADGE_CLASS[entry.bucket]}`}>
          {bucketLabel(entry.bucket)}
        </span>
        <span className="chg-date">{formatArabicDate(entry.date)}</span>
        <span className="chg-version">{entry.version}</span>
      </div>
      <p className="chg-title">
        {scope && <span className="chg-scope">({scope})</span>} {title}
      </p>
    </li>
  );
}

export default function ChangelogTab() {
  const { canAccessTab } = usePermissions();
  const labels = getLabels();

  if (!canAccessTab("changelog")) {
    return <AccessDenied />;
  }

  return (
    <section className="chg-page page-shell" dir="rtl">
      <PageHeader
        eyebrow={labels.changelog_eyebrow}
        title={labels.changelog_title}
        subtitle={labels.changelog_subtitle}
      />
      {LATEST_UPDATES.length === 0 ? (
        <EmptyState title={labels.changelog_empty} />
      ) : (
        <ul className="chg-list">
          {LATEST_UPDATES.map((entry) => (
            <ChangelogRow key={`${entry.date}-${entry.version}`} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}
