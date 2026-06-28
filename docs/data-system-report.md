# Data System Report

This app is a browser-only Arabic RTL SPA. It has no backend database. Data is stored in two places: browser storage for runtime authentication/UI preferences, and the user-selected workspace folder for durable app data.

## Browser Storage

| Storage | Key | Data | Notes |
| --- | --- | --- | --- |
| Runtime memory + `sessionStorage` | Auth session (`xray_auth_session_v1`) | Current signed-in identity (username, role, loginAt) | Survives a page reload but auto-clears when the tab/browser closes (SEC-02). 7-day TTL as a secondary guard. UX convenience, not a security control. |
| `localStorage` | `xray_user_management_v1` | Managed users, password hashes, roles, tab permissions, feature permissions | Stores password hashes, not raw passwords. |
| `localStorage` | `xray_custom_labels_v1` | Customized Arabic UI labels | Used by the settings/labels system. |
| `localStorage` | `xray_last_login_username_v1` | Last username typed at login | Convenience prefill only (`loginPersistence.ts`). |

## Workspace Folder Data

The current workspace layout uses numbered roots, with legacy fallbacks still supported for older workspaces.

| Folder | Data Stored |
| --- | --- |
| `1-Population/` | Monthly population runs, source import data, final processed population, processing summaries, population config. |
| `2-Samples/` | Sample master files, distribution log/current snapshot, main sample mirrors, per-employee sample mirrors, answers, referral/replacement requests, supervisor approval decisions. |
| `3-User Data/` | Workspace user/permission files when initialized through workspace defaults. |
| `4-Reports/` | Generated/report artifacts when report flows write to the workspace. |
| `5-System/` | Backups, browse/table presets, automatic-backup settings/state, activity audit log, internal system files. |
| `6-Templates/` | Inspection templates and template index/selection files. |

Legacy folders still read when present: `Population/`, `.system/`, and `templates/`.

## Population And Sample Files

| File or Pattern | Typical Location | Purpose |
| --- | --- | --- |
| `month.manifest.json` | `1-Population/{month}/` | Month metadata: month/year, processed counts, status, operator info. |
| `risk.raw.json` | `1-Population/{month}/raw/` or legacy month folder | Imported risk rows. |
| `bi.raw.json` | `1-Population/{month}/raw/` or legacy month folder | Imported BI rows when provided. |
| `population.final.json` | `1-Population/{month}/processed/` or legacy month folder | Final processed population rows used for sampling and reporting. |
| `processing.summary.json` | `1-Population/{month}/processed/` | Processing summary/validation data. |
| `sample.master.json` | `2-Samples/{month}/1-Main/` | Drawn sample rows and sample configuration/result metadata. |
| `distribution.log.json` | `2-Samples/{month}/1-Main/` | Append-only assignment event log. |
| `distribution.current.json` | `2-Samples/{month}/1-Main/` | Derived current distribution snapshot. |
| `main.samples.json` | `2-Samples/{month}/1-Main/` | Mirror of all assigned sample entries. |
| `{username}.samples.json` | `2-Samples/{month}/2-Employees/` | Per-employee sample mirror. |
| `{username}.answers.json` | `2-Samples/{month}/2-Employees/` | Employee answers plus referral/replacement requests for that employee. |
| `{supervisor}.decisions.json` | `2-Samples/{month}/3-Approvals/` | Supervisor referral/replacement decisions. |
| `auth-activity.log.json` | `5-System/2-Audit/` | Sign-in and working-hours audit log. |

## Population Row Data Dictionary

Each `population.final.json` row and each sampled `rows[]` item uses the processed population row shape below.

| Field | Meaning |
| --- | --- |
| `stage` | Inspection/risk stage from source data, later normalized through stage mappings. |
| `xrayImageId` | Unique X-ray image identifier; main matching key for BI, risk, sample, distribution, and answers. |
| `xrayEntryDate` | Date the X-ray image entered/was registered. |
| `portCode` | Port code from the source data. |
| `portType` | Port type/category. |
| `portName` | Port name used for stratification and reporting. |
| `declarationNumber` | Customs declaration number. |
| `declarationDate` | Customs declaration date. |
| `plateOrContainerNumber` | Plate number or container number. |
| `chassisNumber` | Vehicle chassis number when available. |
| `xrayLevelOneResult` | Level 1 result: `سليمة` or `اشتباه`. |
| `xrayLevelTwoResult` | Level 2 result: `سليمة` or `اشتباه`. |
| `movementType` | Movement/import/export/transit type from source data. |
| `reportNumber` | Report number when available. |
| `targetedByRiskEngine` | Whether/how the risk engine targeted the record. |
| `riskMessage` | Risk message/indicator text. |
| `certScanStatus` | `Certscan` or `NonCertscan` based on CertScan matching. |
| `certScanSnippet` | Matched CertScan snippet used by the app. |
| `originalCertScanSnippet` | Original CertScan text before cleanup/normalization. |
| `biEnrichmentStatus` | `BI Not Provided`, `BI Matched`, or `BI Not Matched`. |
| `biMatched` | Boolean match flag for BI enrichment. |
| `biFilledFields` | Field names that were filled from BI because risk data was empty. |
| `rawRow` | Optional original source row values for traceability. |
| `sourceSheetName` | Excel sheet name where the row came from. |
| `sourceRowNumber` | Original Excel row number. |

## Sample Master Data Dictionary

`sample.master.json` stores sampling metadata plus the drawn rows.

| Field | Meaning |
| --- | --- |
| `rngSeed` | Seed used for deterministic random draw. |
| `totalRequested` | Requested total sample size. |
| `totalActual` | Actual sample size drawn. |
| `certScanRequested` | Requested CertScan sample count. |
| `nonCertScanRequested` | Requested NonCertScan sample count. |
| `certScanActual` | Actual CertScan rows drawn. |
| `nonCertScanActual` | Actual NonCertScan rows drawn. |
| `portAllocations[]` | Per-port quota and actual draw details. |
| `stageAllocations[]` | Per-stage quota and actual draw details. |
| `drawnAt` | Draw timestamp. |
| `drawnBy` | Username that drew the sample. |
| `revision` | Monotonic revision for conflict detection. |
| `_writeToken` | Internal write token for compare-and-swap conflict detection. |
| `rows[]` | Drawn sample rows; each item is a processed population row. |

### Port Allocation Fields

| Field | Meaning |
| --- | --- |
| `portName` | Port being allocated. |
| `populationSize` | Population rows in that port. |
| `certScanCount` | CertScan population rows in that port. |
| `nonCertScanCount` | NonCertScan population rows in that port. |
| `allocatedQuota` | Total sample quota assigned to the port. |
| `certScanQuota` | CertScan quota assigned to the port. |
| `nonCertScanQuota` | NonCertScan quota assigned to the port. |
| `actualCertScanDrawn` | CertScan rows actually drawn for the port. |
| `actualNonCertScanDrawn` | NonCertScan rows actually drawn for the port. |
| `actualTotalDrawn` | Total rows actually drawn for the port. |

### Stage Allocation Fields

| Field | Meaning |
| --- | --- |
| `stageKey` | Normalized stage key: `first`, `second`, `third`, or `fourth`. |
| `stageLabel` | Arabic display label for the stage. |
| `populationSize` | Population size in that stage. |
| `targetQuota` | Target sample count for that stage. |
| `actualDrawn` | Actual rows drawn for that stage. |
| `certScanDrawn` | CertScan rows drawn for that stage. |
| `nonCertScanDrawn` | NonCertScan rows drawn for that stage. |

## Distribution And Employee Data Dictionary

| File | Fields |
| --- | --- |
| `distribution.log.json` | `monthFolderName`, `revision`, `_writeToken`, `events[]`. |
| `events[]` | `eventId`, `eventType`, `xrayImageId`, `assignedTo`, `replacedById`, `reassignedTo`, `eventAt`, `eventBy`, `notes`, `dailyQuota`, `daysRemainingAtAssignment`. |
| `distribution.current.json` | `monthFolderName`, `logRevision`, `derivedAt`, totals for assigned/completed/replaced/pending, `entries[]`, `quotas`. |
| `entries[]` | `xrayImageId`, `assignedTo`, `status`, `replacedById`, `lastEventAt`, `row`. |
| `quotas` | Per employee: `username`, `sampleCount`, `dailyQuota`, `daysRemainingAtAssignment`, `assignedAt`. |
| `{username}.samples.json` | Employee mirror: `monthFolderName`, `username`, `updatedAt`, `sourceLogRevision`, `entries[]`. |
| `{username}.answers.json` | `username`, `monthFolderName`, `revision`, `_writeToken`, `lastUpdatedAt`, `items[]`, `referralRequests[]`, `replacementRequests[]`. |
| `items[]` | `xrayImageId`, `templateId`, `templateVersion`, `answers`, `lastSavedAt`, `submittedAt`, `answeredBy`, `status`. |
| `{supervisor}.decisions.json` | `supervisorUsername`, `monthFolderName`, `referralDecisions[]`, `replacementDecisions[]`, `lastUpdatedAt`. |
| `auth-activity.log.json` | `revision`, `updatedAt`, `entries[]`. |
| activity `entries[]` | `id`, `username`, `role`, `signedInAt`, `lastSeenAt`, `signedOutAt`, `durationMs`, `closeReason`. |

## Default Inspection Template

The default template created from the Template Builder is named `نموذج ضمان جودة الأشعة`, version `1`. It covers employee inspection answers for each assigned X-ray sample. The template is saved as a normal template file in `6-Templates/{templateId}.json`, listed in `templates.index.json`, and can be selected through `inspection-template-selection.json`.

### Phase 1: ضمان جودة الصورة

This phase checks whether the X-ray image exists and whether the image is usable for review.

| Field | Type | Required | Options / Condition |
| --- | --- | --- | --- |
| `هل يوجد صورة` | Dropdown | Yes | Options: `نعم`, `لا`. |
| `سبب عدم وجود الصورة` | Dropdown | No | Shows when `هل يوجد صورة = لا`. Options: `المعرف غير صحيح`, `لا يوجد رقم لوحة`, `لا يوجد مستند فحص الصورة`, `مؤرشف لفترات سابقة`. |
| `هل يوجد تحديد` | Dropdown | Yes | Shows when `هل يوجد صورة = نعم`. Options: `نعم`, `لا`. |
| `مستوى جودة الصورة` | Dropdown | Yes | Shows when `هل يوجد صورة = نعم`. Options: `عالي`, `متوسط`, `منخفض`. |
| `اسباب انخفاض جودة الصورة` | Dropdown | No | Shows when `مستوى جودة الصورة` is not `عالي`. Options: `الأرسالية غير كاملة`, `جودة التقاط الصورة منخفضة`, `يوجد تموجات في الصورة`, `اخرى`. |
| `سبب انخفاض الجودة (أخرى)` | Textarea | No | Shows when `اسباب انخفاض جودة الصورة = اخرى`. |

### Phase 2: ضمان جودة النتيجة

This phase checks whether the inspection result is correct and captures suspicion details when the result is suspicious.

| Field | Type | Required | Options / Condition |
| --- | --- | --- | --- |
| `صحة النتيجة` | Dropdown | Yes | Shows when `هل يوجد صورة = نعم`. Options: `سليمة`, `اشتباه`. |
| `تقييم الاشتباه` | Dropdown | No | Shows when `صحة النتيجة = اشتباه`. Options: `عالي`, `متوسط`, `منخفض`. |
| `الاصناف المشبوهة` | Textarea | No | Shows when `صحة النتيجة = اشتباه`. |
| `الية التهريب المحتملة` | Textarea | No | Shows when `صحة النتيجة = اشتباه`. |
| `الملاحظات العامة` | Textarea | No | Shows when `هل يوجد صورة = نعم`. |

The inspection panel gates phases in order: the next phase is enabled after required visible fields in the current phase are completed.

## 4-Reports/designs/

Report Designer saves and loads user-created report designs under this sub-folder.

| File or Pattern | Location | Purpose |
| --- | --- | --- |
| `designs.index.json` | `4-Reports/designs/` | Index of all saved report designs (`JsonEnvelope<DesignIndex>`). Lists each design's `reportId`, `reportName`, `version`, and `updatedAt`. |
| `{reportId}.json` | `4-Reports/designs/` | Individual `ReportDocument` persisted as `JsonEnvelope<ReportDocument>`. Contains the full document: theme, pages, and all canvas elements (text, shape, image). |

Both files use `safeWriteJson` / `safeReadJson` and the `JsonEnvelope` schema-versioning wrapper (current `schemaVersion: 1`). The index is re-derived from the design files on load; `designs.index.json` is the live index that the Report Designer list view reads.

## Templates, Preferences, Backups

| File or Pattern | Location | Purpose |
| --- | --- | --- |
| `templates.index.json` | `6-Templates/` | Template list and latest versions. |
| `{templateId}.json` | `6-Templates/` | Inspection template schema and fields. |
| `inspection-template-selection.json` | `6-Templates/` | Selected active inspection template. |
| `admin-shared.browse-preset.json` | `5-System/user-presets/` | Shared/admin table column preferences. |
| `{username}.browse-preset.json` | `5-System/user-presets/` | User-specific table column preferences. |
| `backup.manifest.json` and copied data files | `5-System/3-Backups/{timestamp}/` | Manual/automatic backup snapshots. |
| `population.csv` | `5-System/powerbi-export/{month}/` | All `ExecutiveReportRow` records (UTF-8 BOM CSV, 26 columns). |
| `sample.csv` | `5-System/powerbi-export/{month}/` | `selectedInSample=true` subset of `population.csv`. |
| `LISEZMOI.txt` | `5-System/powerbi-export/{month}/` | Bilingual connection instructions (Arabic + English) for Power BI Desktop. |

## Data Protection Notes

- JSON writes use the safe write layer where available: temporary write, commit, backup `.bak`, and content-hash validation.
- Concurrent writes use Web Locks or compare-and-swap loops in high-conflict areas such as distribution and answer files.
- The activity log is best-effort workspace audit data. It records app-observed time, including heartbeat and close events when the browser delivers them; it is not a centralized attendance system.
