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

> **Superseded 2026-10-12.** The wording below replaces the 2026-07-29 handoff wording (the earlier
> table described Level 2 as the risk-engine level, Level 3 as the other-teams level and Level 4 as
> the seizure level). The domain owner supplied the department's official slide — *scope* and
> *determinants* per level — and it is what the executive report's glossary page now prints.

| Level | Subtitle | Scope — «نطاق المستوى (بري – بحري)», verbatim | Determinants — «المحددات» |
|---|---|---|---|
| المستوى الأول | حالات الضبط المؤكدة | يعني بالحالات التي تتضمن محاضر ضبط أمنية وجمركية وحالات التجاوز المُبلغ عنها من جهات خارجية ولم يتم الاشتباه بها من قبل كلا المستويين أو أحدهم. | محاضر الضبط الأمنية والجمركية · حالات التجاوز المبلغ عنها من جهات خارجية · عدم الاشتباه من كلا المستويين أو أحدهم |
| المستوى الثاني | حالات الاشتباه المؤكدة | يعني بالحالات التي تتضمن عدم الاشتباه من قبل كلا المستويين أو أحدهم، وتم الاشتباه بها من أحد الفرق الأمنية الأخرى (الوسائل الحية، أو المعاينة، أو التفتيش الأمني، أو التفتيش المعاكس). | عدم الاشتباه من كلا المستويين أو أحدهم · الاشتباه من أحد الفرق الأمنية الأخرى |
| المستوى الثالث | حالات عدم الاشتباه على أساس المخاطر | يعني بالحالات التي تتضمن محرك مخاطر ولم يتم الاشتباه بها من المستوى الأول والثاني. | وجود مؤشر مخاطر على الإرسالية · عدم الاشتباه من كلا المستويين |
| المستوى الرابع | حالات الاشتباه غير المؤكدة | يعني بالحالات التي تم الاشتباه بها من قبل المستوى الأول أو الثاني في الأشعة ولم يتم الاشتباه بها من قبل أي من الفرق الأمنية ولا يوجد عليها محرك مخاطر، وذلك لأكبر ثلاث منافذ في المنافذ البحرية والبرية حسب حجم الإرساليات. | لم يتم الاشتباه بها من كامل الفرق الأمنية · لا يوجد عليها مؤشر مخاطر · أكبر ثلاث منافذ حسب حجم الإرساليات |

**How the data agrees (checked on the Jan–Aug 2026 workbook, executive report page 8, «مصفوفة النتائج»):**
Level 3 is 99.9% سليمة–سليمة (not suspected by L1/L2); Level 4 has no سليمة–سليمة rows at all and
18.5% اشتباه–اشتباه (it requires L1 or L2 to have suspected); Level 1 is mostly not suspected by
L1/L2. The earlier claim that a Level-1 case is one where L1/L2 raised the suspicion, and that a
Level-4 case is one they never suspected, was the **reverse** of the official definition and of the
data — do not reintroduce it. The **رقم المحضر** column (`NormalizedRiskRow.reportNumber` /
`hasReport`, see [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md#risk-data-columns-normalizedriskrow))
is the محضر ضبط behind a Level-1 case; the exact confirmation/seizure process afterward is outside
this app's own review scope.

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
