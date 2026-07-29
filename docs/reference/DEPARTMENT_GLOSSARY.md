# Department Glossary — إدارة ضمان جودة الأشعة اللاحقة

The department's own official terminology slide (شريحة 3، "المعجم ودلالات المستويات"), shared by
the domain owner 2026-07-29. **This is a different source from `zatca-customs-glossary-ar.pdf`**
(ZATCA's general customs/tax/zakat legal glossary) — this one is internal to the X-ray quality
assurance department itself, and is the authoritative source for the four المستوى scenarios and
the app's own core vocabulary (سليمة/اشتباه/مجتمع الحالات/العينة/التوزيع/CertScan/مطابقة BI).

**Header on the slide:**
> هيئة الزكاة والضريبة والجمارك — قطاع الشؤون القانونية — الإدارة العامة لضمان الجودة والامتثال —
> إدارة ضمان جودة الأشعة اللاحقة

## The four المستوى scenarios

**Confirmed: these are four distinct detection scenarios studied independently of each other,
each defined by its own criteria — NOT an ordinal severity ranking.** (Domain owner, 2026-07-29:
*"they are 4 scenarios we study different from each other each based on certain criteria."* This
matches and now sources precisely what [[risk-levels-are-categorical]] already captured from an
earlier conversation about this same reference deck.)

The Arabic slide text is the **final, authoritative wording** — the "Domain owner's understanding"
column is a plain-language gloss for our own comprehension, checked against that text, not a
replacement for it.

| Level | Arabic definition (verbatim from the slide — final) | Domain owner's understanding (2026-07-29) |
|---|---|---|
| المستوى الأول | الحالات التي تم الاشتباه بها في الأشعة من قبل المستوى الأول أو الثاني، دون مؤشرات من الفرق الأمنية الأخرى ودون محجرات مخاطر. | L1 and L2 suspected the shipment (ارسالية), and no other team suspected it and there was no risk-engine indicator. |
| المستوى الثاني | الحالات التي تشمل محجرات مخاطر، ولم يتم الاشتباه بها من قبل المستوى الأول والثاني. | There was a risk-engine indicator, but L1 and L2 didn't suspect it. |
| المستوى الثالث | الحالات التي لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من قبل أحد الفرق الأمنية الأخرى. | L1/L2 didn't suspect it, but another team did. |
| المستوى الرابع | الحالات التي تحتوي على ضبط أمني أو اجتازت الأشعة من جهات خارجية دون اكتشاف الاشتباه من المسؤولين. | L1 and L2 didn't suspect it, and it made it across the border into the Kingdom — another authority later caught the smuggler and filed a محضر ضبط (seizure/apprehension report). |

**Level 1 connects directly to stored data** (corrected 2026-07-29 — not Level 4, see below): the
**رقم المحضر** column (`NormalizedRiskRow.reportNumber` / `hasReport`, see
[`DATA_DICTIONARY.md`](DATA_DICTIONARY.md#risk-data-columns-normalizedriskrow)) is the محضر ضبط
associated with a Level-1 case — L1/L2 (our X-ray screening levels) raised the suspicion. (The
exact confirmation/seizure process afterward is outside this app's own review scope — our own
team's part is the document/image study described below, not a physical inspection.) A Level-4
case, by contrast, is one L1/L2 never suspected at all — any seizure there happens outside the
department's own screening/report trail entirely, caught by another authority.

**How this maps to the data:** this is the scenario the risk sheet's `stage` column
(`المستوى`/`STAGE` → `NormalizedRiskRow.stage`, see [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md#risk-data-columns-normalizedriskrow))
records per case. It is a **different axis** from `xrayLevelOneResult`/`xrayLevelTwoResult`
(the two X-ray inspection *passes*, i.e. `DecisionLevel` in `decisionFactTable.ts` — see
[`APP_AUDIT_MODEL.md`](APP_AUDIT_MODEL.md)) — don't conflate the two. Never render these 4
levels with severity language, colour-as-alarm ramps, or an implied level-N-worse-than-level-(N-1)
ordering.

## Core glossary terms

| Term | Arabic definition (verbatim) | Meaning | Maps to (app) |
|---|---|---|---|
| سليمة | حالة لا يوجد بها ما يثير الاشتباه بعد مراجعة الصور وتحليلها وفق معايير الجودة المعتمدة. | Clean — nothing raised suspicion after reviewing/analyzing the images per approved quality standards. | `xrayLevelOneResult`/`xrayLevelTwoResult`/etc. = `"سليمة"` (`normalizeResultValue()`) |
| اشتباه | مؤشر أو نمط في الأشعة يشير للاحتمال لوجود مخالفة أو أصناف محظورة، ويستلزم مراجعة إضافية. | Suspicion — an indicator/pattern suggesting a possible violation or prohibited items, requiring additional review. | same fields, `= "اشتباه"` |
| مجتمع الحالات | جميع الحالات المشمولة بالتحليل خلال فترة زمنية محددة وفق معايير الاختيار المعتمدة. | Case population — every case covered by analysis within a defined period, per approved selection criteria. | The month's processed population (`PreparedPopulationRow[]`, `population.final.json`) |
| العينة | مجموعة فرعية من مجتمع الحالات يتم اختيارها عشوائيًا أو بطرق موجهة لأغراض المراجعة والتحليل. | Sample — a subset of the case population, drawn randomly or via targeted methods, for review/analysis. | `src/data/sampling/` (Hamilton apportionment + Fisher-Yates draw), `SampleMasterData` |
| التوزيع | توزيع مجتمع الحالات على المستويات وفق النتائج المحققة، لقياس الأداء ورصد الاتجاهات. | Distribution — spreading the case population across the levels per achieved results, to measure performance and track trends. | `src/data/distribution/` (assignment event log, `DistributionCurrentData`) |
| CertScan | نظام الإدارة والتدقيق للجودة للأشعة اللاحقة، يُستخدم لتسجيل ومراجعة وتصنيف الحالات. | The management/quality-audit system for post-X-ray review — used to record, review, and classify cases. | `certScanStatus` (`"Certscan"`/`"NonCertscan"`) on `PreparedPopulationRow`, matched via the pasted CertScan list in `populationProcessor.ts` |
| مطابقة BI | مطابقة بيانات الإرسالات بين الأنظمة المختلفة عبر أدوات ذكاء الأعمال لضمان الدقة والتكامل الرقمي. | BI matching — reconciling shipment data across systems via business-intelligence tools, for accuracy and digital integration. | `biEnrichmentStatus`/`biMatched`/`biFilledFields` on `PreparedPopulationRow` (the risk↔BI merge in `enrichDraftRowFromBi()`) |

## See also

[`DATA_DICTIONARY.md`](DATA_DICTIONARY.md) (column-by-column meanings) ·
[`APP_AUDIT_MODEL.md`](APP_AUDIT_MODEL.md) (the L1/L2 audit purpose) ·
[`zatca-customs-glossary-ar.pdf`](zatca-customs-glossary-ar.pdf) (ZATCA's general legal/customs
glossary — a separate, broader source from this department-specific one)
