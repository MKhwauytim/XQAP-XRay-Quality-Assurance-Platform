# Data Dictionary — Risk & BI Excel Columns

Working reference for what every risk/BI Excel column (and the fields derived from them)
actually *means*, built collaboratively with the domain owner. Terminology is checked against
the official ZATCA glossary wherever the term is a formal customs/tax concept; operational
terms that ZATCA doesn't define (movement numbers, ports, physical inspection roles) are
documented from the domain owner's working knowledge instead, and flagged as such below.

## Terminology reference

**Source:** هيئة الزكاة والضريبة والجمارك (ZATCA) — *معجم الزكاة والضريبة والجمارك*
("Glossary of Zakat, Tax and Customs"), official public glossary, 429 pages, multilingual
(Arabic / English / French / Chinese) per entry.

- Downloaded 2026-07-29 from `https://zatca.gov.sa/ar/MediaCenter/Publications/Documents/` and
  saved at [`docs/reference/zatca-customs-glossary-ar.pdf`](zatca-customs-glossary-ar.pdf)
  (~21.1 MB, PDF 1.7).
- The glossary states it is intended for awareness/education, not as a binding legal reference —
  the applicable laws/regulations remain authoritative. Use it here as the *terminology*
  authority (correct Arabic/English names and definitions), not as an app-behavior spec.
- Text extraction tools (`pdftotext`, the Read tool's PDF pipeline) could not parse this PDF's
  Arabic text layer (broken ToUnicode/CID mapping — `Unknown character collection 'Adobe-GB1'`).
  Every quote below was read directly off rendered pages in-browser (page numbers cited are the
  PDF's own printed page numbers, confirmed via its interactive letter-index on p.2–4).

### Confirmed official ZATCA glossary definitions

| Arabic term | English term | Page | Definition (Arabic, verbatim) |
|---|---|---|---|
| البيان الجمركي | Customs Declaration | p.133 | بيان البضاعة، أو الإقرار المقدم من المستورد، أو من ينوب عنه، المتضمن تحديد العناصر المميزة لتلك البضاعة المصرح عنها وكميتها بالتفصيل وفق أحكام نظام الجمارك الموحد. |
| بيان الحمولة (المنافيست) | Manifest | p.134 | المستند الذي يتضمن وصفًا شاملًا للبضائع المشحونة على وسائل النقل المختلفة. |
| بيان الشحن | Cargo Declaration | p.135 | تعني هذه العبارة المعلومات المقدمة قبل أو عند وصول أو مغادرة وسائل النقل المخصصة للاستخدام التجاري والتي توفر البيانات المطلوبة من قبل الهيئة فيما يتعلق بالشحنات التي يتم إحضارها إلى أو إخراجها من منطقة الجمارك. |
| مانيفست الشحن | Cargo Manifest | p.325 | قائمة بالبضائع التي تتكون منها الشحنة المنقولة في وسائل النقل أو في وحدة نقل؛ يوفر بيانات مثل أرقام مستندات النقل، والشاحن والمرسل إليه والعلامات والأرقام ونوع العبوات ووصف وكميات البضاعة، **ويجوز استخدامه بدلاً من بيان الشحن**. |
| بوليصة الشحن | Bill of Lading | p.127 | عقد قانوني يؤدي ثلاث وظائف: (1) إيصال باستلام البضائع، (2) سند ملكية، (3) إثبات لعقد شحن البضائع. |
| الحاوية | Container | p.177 | صنف من معدات النقل مزودة بالرافعة، وصهريج قابل للنقل، أو هياكل مماثلة أخرى. |

**Key distinction confirmed from the glossary itself:** بيان الحمولة (Manifest, general) ≠
بيان الشحن (Cargo Declaration, the arrival/departure information submitted to the Authority) ≠
مانيفست الشحن (Cargo Manifest, a specific goods listing that the glossary explicitly says *may
be submitted instead of* بيان الشحن). These are related but distinct — don't treat them as
synonyms.

### Terms NOT found as standalone glossary entries

- **رقم الحركة / قيد الحركة** (Movement Number / Movement Entry) — not defined in this glossary.
  This is Fasah-platform (منصة فسح) operational terminology, not a ZATCA legal/glossary term.
  Fasah's own documentation describes vehicle-movement data as being created in the customs
  system at the land port and sent to Fasah, where it's linked to land import/export
  declarations — consistent with the domain owner's working definition below, but this is a
  system/platform concept, not a defined legal term.
- **منفذ** (Port/border-crossing, standalone) — not checked as a standalone glossary entry yet;
  treated as operational terminology below.
- **معاينة / معاين** (Inspection / Inspector) — not checked in this glossary yet (the domain
  owner's own prior research already covers this in detail from other sources).

---

## Risk data columns (`NormalizedRiskRow`)

| # | English field | Arabic column name(s) | Meaning / Purpose |
|---|---|---|---|
| 1 | `xrayImageId` | رقم صورة الاشعة / معرف الأشعة / XRAY_SCAN_ID | Unique identifier generated for every X-ray image captured. |
| 2 | `portCode` | رمز المنفذ / المنفذ / رمز الجمرك / PORT_CD | The code the system uses to identify the port. *(Operational term — منفذ is not a standalone ZATCA glossary entry checked so far.)* |
| 3 | `portName` | اسم المنفذ | Name of the port. |
| 4 | `portType` | نوع المنفذ | Port type: land (بري), sea (بحري), air (جوي), or rail (سكة حديد). |
| 5 | `movementNumber` | رقم الحركة / قيد الحركة | Every truck/vehicle entering the port gets a unique movement number; **every one of its procedures ties back to this number** — unlike `xrayImageId`, where one vehicle/shipment could have 10 separate images under different IDs, the movement number stays the single unique reference even if 100 images get captured for the same shipment. **Not a ZATCA glossary term** — this is Fasah-platform operational terminology (see note above), consistent with how فسح describes vehicle-movement data. |
| 6 | `movementDate` | تاريخ الحركة | The date the vehicle entered the port and the movement number was created. |
| 7 | `movementHijriDate` | تاريخ الحركة هجري | Hijri equivalent of `movementDate`. |
| 8 | `declarationNumber` | رقم البيان / رقم البيان المبدئي | The declaration's unique, stable number — like the movement number, it doesn't change. Identifies **البيان الجمركي** (Customs Declaration, ZATCA-defined, p.133): the detailed declaration submitted by the importer/representative describing the goods and quantities declared. |
| 9 | `transitDeclarationNumber` | رقم بيان الترانزيت | Conceptually the same *kind* of thing as `declarationNumber` — a number identifying a declaration that describes the goods and quantities — but scoped to the transit (العبور) sheet specifically, and kept as its own field since the transit sheet carries both this and a separate preliminary declaration number on the same row (see collision fix, v59.74). |
| 10 | `declarationDate` | تاريخ البيان / تاريخ البيان ميلادي / تاريخ بيان الترانزيت | |
| 11 | `declarationHijriDate` | تاريخ البيان هجري | |
| 12 | `manifestNumber` | رقم المانفيست / رقم المنافيست | Reference number of the بيان الحمولة / مانيفست (Manifest, ZATCA-defined, p.134/325) — the document listing all goods carried on the transport unit. |
| 13 | `manifestType` | نوع المانفيست / نوع المنافيست | |
| 14 | `manifestDate` | تاريخ المانفيست / تاريخ المنافيست | |
| 15 | `plateOrContainerNumber` | رقم اللوحة / رقم الحاوية / رقم تسلسل الحاوية / PLATE_NO | Vehicle plate number (land ports). At sea ports there's no vehicle, so this is the **container number** (ZATCA-defined **الحاوية**, p.177: transport equipment such as a crane-loaded truck, portable tank, or similar structure) instead — different physical thing, but the same *role*: identifying the transport unit carrying the goods. |
| 16 | `finalDestination` | الوجهة النهائية | |
| 17 | `entryDate` | تاريخ الدخول | |
| 18 | `exitDate` | تاريخ الخروج | |
| 19 | `chassisNumber` | رقم الهيكل / رقم الشاص | The vehicle's chassis number. |
| 20 | `reportNumber` | رقم المحضر | The seizure/apprehension report number (محضر ضبط) — associated with a **المستوى الأول** case (corrected 2026-07-29 — not Level 4): L1/L2 raised the suspicion themselves. See [`DEPARTMENT_GLOSSARY.md`](DEPARTMENT_GLOSSARY.md#the-four-المستوى-scenarios) — the confirmation process itself is outside this app's own review scope (our team's part is document/image study, not physical inspection). |
| 21 | `xrayLevelOneResult` | نتيجة المستوى الأول / المستوى الأول | Result from the level-1 X-ray employee. The X-ray employees issue several possible values, but what matters downstream is only the collapsed binary: سليمة (clear) or اشتباه (suspect) — see `normalizeResultValue()`. |
| 22 | `xrayLevelTwoResult` | نتيجة المستوى الثاني / المستوى الثاني | Same as above, level-2 employee (second X-ray review). |
| 23 | `inspectorResult` | نتيجة المعاين / نتيجة الفتيش اليدوي | **Distinct from the X-ray screening.** This is the physical/manual customs inspection result — a second line of defense where the customs examiner (المعاين) physically opens and inspects the goods by hand, giving سليمة or اشتباه. Matches ZATCA's معاينة جمركية concept (physical verification of goods against the declaration) as distinct from the X-ray-based screening. |
| 24 | `oppositeInspectorResult` | نتيجة المفتش المعاكس / نتيجة التفتيش المعاكس | |
| 25 | `liveMeansResult` | نتيجة الوسائل الحية | Result from "live means" inspection — i.e. **K9 detection dogs** — giving سليمة or اشتباه. |
| 26 | `xrayEntryDate` | تاريخ دخول الاشعة / تاريخ الاشعة | |
| 27 | `targetedByRiskEngine` | مستهدف محرك المخاطر / استهداف محرك مخاطر | |
| 28 | `riskMessage` | رسالة المخاطر | |
| 29 | `stage` | STAGE / المستوى | |
| — | `movementType` *(derived from sheet name, not a column)* | — | |
| — | `hasReport` *(computed: true if reportNumber is non-blank)* | — | |

## BI data columns (`NormalizedBiRow`)

*(Not yet covered in our walkthrough — table from the earlier message still stands, to be filled
in next.)*

---

## See also

[`APP_AUDIT_MODEL.md`](APP_AUDIT_MODEL.md) — why the app exists and how L1/L2 (`xrayLevelOneResult`/
`xrayLevelTwoResult`) get audited against the other result sources (`inspectorResult`,
`oppositeInspectorResult`, `liveMeansResult`) and a study reviewer's verdict.

[`DEPARTMENT_GLOSSARY.md`](DEPARTMENT_GLOSSARY.md) — the department's own official terminology
slide: verbatim definitions of the four `stage` scenarios (المستوى الأول–الرابع) and core terms
(سليمة/اشتباه/مجتمع الحالات/العينة/التوزيع/CertScan/مطابقة BI).

## Open items / to confirm next

- BI data column meanings (33 fields) — not started.
- `منفذ` and `معاينة` as standalone ZATCA glossary entries — not checked yet; current entries
  above are the domain owner's operational definitions until/unless verified.
- Processed/computed `PreparedPopulationRow` fields (certScanStatus, biEnrichmentStatus, etc.) —
  not started.
