# تصميم محرك التقارير الذكي (Smart Report Engine)

**التاريخ:** 2026-11-05
**الحالة:** مسودة تصميم للمالك، مبنية على البحث والتحقق المرفقين وعلى `docs/superpowers/specs/2026-11-01-report-engine-design.md` (القسم 0 والمبادئ M1 إلى M14).
**ملاحظة منهجية:** الحقائق الموسومة بـ «مؤكد» تم التحقق منها في هذه الجلسة (npm view أو صفحة Microsoft Learn المقروءة فعلاً). كل ما عداه موسوم «غير متحقق» ويعني أنه يطابق الفهم العام للأداة لكنه يحتاج فحص المصدر قبل أن يدخل في المواصفة كحقيقة. لا يوجد في هذه الوثيقة تعديل على ملفات المستودع.

---

## 1. ماذا يفعل Power BI وكيف (بلغة بسيطة)

Power BI ليس «أداة رسم». هو سلسلة من خمس طبقات، كل طبقة تأخذ مخرجات التي قبلها:

### 1.1 البيانات (Get Data و Power Query)

- تربط ملف Excel أو مصدراً آخر، فيعرض لك Power Query معاينة للجدول.
- كل تنظيف تعمله (ترقية الصف الأول إلى headers، تغيير نوع عمود، فلترة صفوف، تقسيم عمود، دمج جداول) يُسجَّل كخطوة باسم Applied Step. مجموع الخطوات هو سكربت بلغة M يُعاد تشغيله عند كل تحديث. (غير متحقق في هذه الجلسة، لكنه السلوك الموثق المعروف.)
- النوع (text / number / date) هو خطوة صريحة. الخلية التي لا تتحول إلى النوع تصبح قيمة Error، وليست صفراً صامتاً. (غير متحقق.)
- أدوات Column quality / distribution / profile تُظهر نسبة الصالح والخطأ والفارغ وعدد القيم المميزة. (غير متحقق، وقيمة الألف صف الافتراضية تحتاج فحصاً.)

**الفكرة التي نأخذها:** التنظيف يكون بتسجيل خطوات قابلة للإعادة، لا بالكتابة فوق المصدر. هذه الفكرة نفسها هي M12 عندنا: قسم raw كما رُفع، ثم قسم processing كل خطوة في ورقة.

### 1.2 النموذج (Semantic Model)

- الجداول النظيفة تُحمَّل إلى محرك VertiPaq العمودي في الذاكرة.
- الشكل الموصى به هو Star Schema: جدول Fact يحمل الأحداث والأرقام (مثلاً صف لكل فحص أشعة)، وجداول Dimension تحمل الأوصاف (المنفذ، التاريخ، الموظف، المستوى).
- العلاقة (Relationship) تربط مفتاح الـ dimension بعمود في الـ fact، ولها cardinality (one-to-many وغيرها) واتجاه فلترة (single أو both). الفلتر يسري من جهة «الواحد» إلى جهة «الكثير»: اختيار منفذ يفلتر الفحوصات. (غير متحقق.)

### 1.3 المقاييس (DAX: Calculated Columns و Measures)

- **Calculated column:** تُحسب صفاً صفاً عند التحديث وتُخزَّن في الجدول (row context).
- **Measure:** صيغة تُكتب مرة واحدة وتُحسب فقط عندما يطلبها visual، تحت الفلاتر الفعالة في تلك الخلية (filter context).
- CALCULATE هي الدالة التي تغيّر الـ filter context: «نفس السؤال، تحت فلاتر مختلفة».
- دوال الزمن (TOTALYTD, SAMEPERIODLASTYEAR) تحتاج جدول تواريخ متصلاً ومُعلَّماً كـ date table.
- (كل ما سبق غير متحقق في هذه الجلسة، لكنه جوهر الوثائق الرسمية.)

### 1.4 كيف يحصل الـ visual على رقمه

- كل visual هو استعلام. الحقول الموضوعة في Axis و Legend و Rows و Columns تصبح أعمدة تجميع (group by). الـ measures الموضوعة في Values تُحسب مرة لكل تركيبة من هذه المجموعات، تحت فلاتر الخلية.
- المجاميع (Totals) ليست جمعاً للخلايا، بل إعادة حساب للـ measure بعد إزالة فلتر الخلية. لذلك مجموع النسب المئوية صحيح ولا يساوي جمع النسب. (غير متحقق.)

### 1.5 اللوحات وحقول الربط (Panes و Field Wells)

- محرر التقرير: شريط أدوات، canvas بصفحات، لوحة Filters، لوحة Visualizations، لوحة Fields. (غير متحقق.)
- لوحة Visualizations فيها ثلاث تبويبات: Build visual (الـ wells)، Format visual، Analytics. (غير متحقق.)
- الـ wells تختلف بنوع الـ visual: bar chart فيه Axis و Legend و Values؛ matrix فيه Rows و Columns و Values. سحب حقل نصي إلى Values يحوّله إلى Count of X. (غير متحقق.)

### 1.6 الفلاتر والتفاعل

- Slicers على الـ canvas، وفلاتر على مستوى visual وpage وreport وdrillthrough، وحالتها تُحفظ مع التقرير. (غير متحقق.)
- افتراضياً كل visual يفلتر ويُبرز (cross-filter / cross-highlight) الآخرين، ويمكن ضبطها لكل زوج. (غير متحقق.)
- Bookmarks تحفظ الصفحة والفلاتر وحالة الـ slicers والإبراز والترتيب والرؤية. (غير متحقق.)
- Themes ملف JSON فيه name و dataColors و background و foreground. (غير متحقق.)

### 1.7 التصدير (وهنا يختلف طريقنا عن Power BI)

مؤكد من صفحة Microsoft Learn (end-user-powerpoint، محدثة 2026-07-23):

- التصدير إلى PowerPoint ينتج كل صفحة كصورة واحدة عالية الدقة، والتقرير الناتج «static». أي الشرائح صور، ليست أشكالاً ولا جداول ولا رسوماً قابلة للتحرير.
- دقة الصفحة المصدَّرة 1280x720، وحجم الشريحة ثابت مهما كان حجم الصفحة الأصلية (الصفحة نفسها تقول «9:16» وهذا يناقض 1280x720، فلا يُعتمد على هذا الرقم).
- الخطوط المخصصة تُستبدل بخط افتراضي، وصور الخلفية تُقص، والـ visuals في حالة drill-down تُصدَّر بحالتها الافتراضية.
- لا يُصدَّر تقرير فوق 50 صفحة أو فوق 500 MB أو يستغرق أكثر من ساعة أو فيه صفحة تحميلها فوق 6 دقائق.
- غير المدعوم: custom visuals غير المعتمدة، ArcGIS، Power Apps، Power Automate، Visio، paginated report visual.
- التصدير متاح في الخدمة فقط (service)، ويحفظ حالة الفلاتر عبر خيار Current values، ويضيف رابطاً يعود إلى التقرير. التقرير المفتوح من bookmark يُصدَّر على حالة ذلك الـ bookmark.
- تصدير PDF يدعم Unicode 6 وما قبله (مهم للنص العربي).
- يوجد add-in منفصل لإدراج صفحة حية داخل PowerPoint.

**الخلاصة:** Power BI قوي في النموذج والحساب والتفاعل، لكنه ضعيف في التصدير الأصلي القابل للتحرير. مبادئنا M1 و M2 و M4 (أربع صيغ معاً، تطابق تخطيط دقيق، PowerPoint أصلي قابل للتحرير) هي بالضبط ما لا يقدمه Power BI. هذا هو الموضع الذي يتفوق فيه محركنا.

---

## 2. كيف تُبنى محركات التقارير عموماً

كل الأدوات الناضجة (Power BI، Tableau، Looker، Metabase، Superset، SSRS، JasperReports، Stimulsoft) تشترك في خط أنابيب واحد، وتختلف فقط في أين تقطعه:

```
Source (أعمدة مُنمَّطة + خطوات تحويل مسجلة)
  -> Semantic Model (dimensions, measures, relationships, named calculations)
    -> Query (JSON مجرد: measures, groupBy, filters, sort, limit)
      -> Visual Spec (نوع visual + ربط الحقول بالأدوار + تنسيق)
        -> Layout (canvas حر للشرائح، أو bands/tablix للجداول الطويلة)
          -> Renderers (renderer لكل صيغة، كلها تقرأ النتيجة المحلولة نفسها)
```

(أوصاف الأدوات أدناه غير متحققة في هذه الجلسة، لكنها تطابق الوثائق العامة.)

### 2.1 الطبقة الدلالية (Semantic Layer)

LookML و MetricFlow (dbt) و Cube و نموذج Power BI التبولي كلها تعرّف:
- **Dimensions:** صفات تُجمِّع عليها.
- **Measures / Metrics:** تجميعات تُعرَّف مرة واحدة.
- **Relationships / Joins** في ملف تعريف منفصل عن أي visual.

المستهلك يسأل «المقياس X حسب البُعد Y مع الفلتر Z». المحرك يحوّل ذلك إلى SQL أو DAX. هكذا يتحقق «عرّف المقياس مرة، استخدمه في كل مكان»، وهذا هو ما يضمن ثبات الأرقام بين المخرجات. وهو حرفياً M6 و M11 عندنا.

### 2.2 كائن الاستعلام (Query Object)

كل أداة لديها شكل وسيط بين الـ visual والبيانات: Power BI يولّد DAX من الـ wells؛ Superset يبني form_data/QueryObject؛ Metabase يبني MBQL (source-table, aggregation, breakout, filter)؛ Cube يأخذ JSON من measures و dimensions و filters و timeDimensions. الدرس: استعلام JSON مجرد قابل للتسلسل، لا كود.

### 2.3 مواصفة الـ visual (Grammar of Graphics)

Vega-Lite يصف الرسم كـ data + mark + encoding channels (x, y, color, size, row, column)، كل قناة مربوطة بحقل له نوع: quantitative / temporal / ordinal / nominal. المقاييس والمحاور والـ legends تُشتق من هذه الأنواع. Tableau (VizQL) يستخدم shelves بالمبدأ نفسه، و Show Me يقترح نوع الرسم من الحقول الموضوعة. الـ field wells في Power BI هي نموذج الربط نفسه.

**الدرس:** نوع الحقل الذي يحدده المستخدم عند الرفع هو ما يقود اختيار الرسم والمحاور والتجميع الافتراضي.

### 2.4 نموذج الـ Pivot

Excel PivotTable (cache + Rows + Columns + Values + Filters) هو نفس ربط dimension/measure مطبقاً على crosstab. Matrix في Power BI و tablix في SSRS الفكرة نفسها. هذا يعني أن ورقة الإحصائيات في M3 (pivots) والـ matrix على الشريحة تعريف واحد بتمثيلين.

### 2.5 المحركات المُصفَّحة (Paginated)

SSRS/RDL و JasperReports/JRXML و Stimulsoft تفصل ثلاثة أشياء: التعريف (template)، التعبئة (ربط البيانات في تخطيط)، والتصدير (render extension لكل صيغة). SSRS يُخرج HTML و PDF و Excel و Word و PowerPoint من تعريف واحد. JasperReports يستخدم bands (title, pageHeader, columnHeader, detail, groupHeader/Footer, summary) والمحرك يملأ الـ bands لكل سجل. Stimulsoft Reports.JS يشغّل المصمم والمحرك كليهما في المتصفح.

**الدرس الحاسم لتطابق التخطيط (M2):** يُحسب التخطيط مرة واحدة إلى شجرة مُحلولة (هندسة مطلقة + بيانات محلولة)، ثم كل renderer يُسلسلها. لا يُعاد التخطيط لكل صيغة. هذا بالضبط قرار المالك رقم 1: «one absolute, pre-measured layout model».

---

## 3. تصميم محركنا: عقل واحد ببابين

### 3.0 المبدأ

المحرك وحدة headless خالية من React ومن أي استيراد من كود الأشعة (M9). كل ما يدخله ويخرج منه مستندات JSON مُنمَّطة ومُتحقَّق منها بـ schema. الباب البرمجي والباب البشري ينتجان **المستندات نفسها** ويمران عبر **البوابات نفسها**. لا توجد حالة مكررة ولا مسار ثانٍ.

```
                 ┌──────────────────────────────────────────────┐
  (a) API door   │                                              │
  issueReport(   │   1. DatasetDef  (أعمدة مُنمَّطة + خطوات)      │
    template,  ──┤   2. SemanticModel (pack + measures + rels)  │
    packId,      │   3. ReportSpec  (pages, visuals, wells,     │
    datasets,    │                   filters, slicers, theme)   │
    params)      │   4. Resolve  (worker, limits, time budget)  │
                 │   5. Layout   (pre-measured, absolute)       │
  (b) User door  │   6. Gates    (figure parity, layout parity, │
  تبويبة         │               lint, reconciliation, OOXML)   │
  «التقارير»  ───┤   7. Emit     {html, pdf, pptx, xlsx,        │
  (editor over   │               lintReport, parityReport}      │
   ReportSpec)   │                                              │
                 └──────────────────────────────────────────────┘
```

### 3.a الباب البرمجي (API door)

- التوقيع كما في المواصفة: `issueReport(template, packId, datasets, params) → { html, pdfPrintable, pptx, xlsx, lintReport, parityReport }`.
- `template` هو `ReportSpec` (القسم 5) أو رقم تصميم من الكتالوج (M14) مع قائمة أرقام الشرائح.
- `datasets` مصفوفة من `{ datasetId, columns, rows }` بالأعمدة الخام كما رُفعت (M12).
- `params` قيم المعاملات المعلنة في الـ template (الشهر، المنفذ، N في top N).
- المضيف يقرر أين تذهب الملفات. المحرك لا يقرأ ولا يكتب workspace المضيف.
- الاستدعاء من الأشعة: كود التطبيق يبني datasets من population/sample/distribution/answers ويمرر `packId = "xray"`. هذا يحل محل مسار deck2 الحالي تدريجياً.

### 3.b الباب البشري: تبويبة «التقارير»

رحلة الموظف (كلها فوق الـ API نفسه، التبويبة محرر لـ `ReportSpec` ليس أكثر):

1. **رفع Excel** عبر `workbookWorker.ts` الموجود (مؤكد: المستودع يملك worker لتحليل Excel و `adhocSourceTable.ts` يقرأ workbook أو نصاً ملصوقاً إلى `SourceTable {sheetName, headers, rows}`).
2. **تحديد أنواع الأعمدة** (شاشة إلزامية، لا تُتخطى): لكل عمود نوع بيانات (text / number / date / boolean) ودور دلالي (dimension / measure) ومستوى قياس (nominal / ordinal / quantitative / temporal). المحرك يقترح، الموظف يؤكد. لوحة profile لكل عمود: صالح / خطأ / فارغ / مميز. أي خلية لا تتحول تُعدّ خطأ محسوباً، والإصدار يتوقف إذا كان العمود مستخدماً في measure (fail closed، M13).
3. **ربط اختياري بحزمة المجال (domain pack):** إذا طابقت الأعمدة قاموس `DATA_DICTIONARY.md` يقترح المحرك الربط (نسخ نمط `autoDetectMapping` من ad-hoc import، لا استيراده). الربط يفتح measures الحزمة الجاهزة؛ بدونه يبقى الموظف على measures يعرّفها بنفسه من أعمدته.
4. **تعريف measures بأمان:** نموذج (form) يختار العمود والتجميع والفلتر الاختياري وقسمة اختيارية على measure آخر. تحته عرض التعبير النصي للمتقدمين. لا eval أبداً (القسم 4.3).
5. **Canvas بهوية deck3:** شبكة snap بوحدات شبكة لا بكسل، صفحة 16:9، لوحة visuals (بطاقة، KPI، أعمدة، خطوط، دائري، جدول، matrix، نص، فاصل) من مجموعة deck3.
6. **السحب إلى wells:** لوحة الحقول تعرض الأعمدة بأيقونة نوعها؛ كل visual يعلن wells (axis, legend, values, rows, columns, tooltip) وأنواعها المقبولة وعددها. سحب حقل نصي إلى Values يتحول إلى Count بشكل مرئي وصريح لا صامت. الربط غير الصالح يُرفض بالرسالة لا بالتجاهل.
7. **الفلاتر والـ slicers:** slicer مرئي على الـ canvas، فلتر على مستوى visual و page و report. الحالة تُحفظ في `ReportSpec`. التصدير الثابت لا يعرف التفاعل، لذلك **وحدة التصدير هي bookmark** (صفحة + حالة فلاتر + حالة slicers + رؤية العناصر)، ومخرجات الإصدار تسجل أي bookmark أُصدرت عليه. (هذا يطابق ما أكدته صفحة Learn: التقرير المفتوح من bookmark يُصدَّر على حالته.)
8. **الإصدار:** زر واحد، يمر بالبوابات نفسها، يُخرج الأربع صيغ معاً أو لا شيء مع رسالة عربية واحدة تسمي الشريحة والكتلة والقاعدة (M1، M13).

**الصلاحيات:** ثلاث قدرات منفصلة عبر `canMutate`: `reports.author` (إنشاء وتعديل spec)، `reports.run` (تشغيل spec موجود على Excel جديد)، `reports.view`. الموجود اليوم قدرة واحدة فقط `report-designer.edit` (غير متحقق في هذه الجلسة، من تقرير repo-fit).

**القرار 5 للمالك يبقى سارياً:** الإدارات الأخرى تختار من الكتالوج وترسل Excel، والمشرف أو الأدمن يربط ويصدر. الباب البشري يضيف فوق ذلك إمكانية أن يبني الموظف المخوَّل تقريره بنفسه.

---

## 4. الطبقة الدلالية (Semantic Layer)

### 4.1 حزم المجال (Domain Packs)

```json
{
  "packId": "xray",
  "schemaVersion": 1,
  "fields": [
    { "id": "portName", "label": "المنفذ", "type": "text", "role": "dimension", "aliases": ["المنفذ", "Port"] },
    { "id": "inspectionDate", "label": "تاريخ الفحص", "type": "date", "role": "dimension", "grain": "day" },
    { "id": "riskLevel", "label": "المستوى", "type": "text", "role": "dimension", "ordinal": false }
  ],
  "measures": [ "..." ],
  "dimensions": [ "..." ],
  "parameters": [ { "id": "month", "type": "month", "required": true } ]
}
```

- النواة لا تعرف أي حقل. الحزمة تُحمَّل كبيانات وتُتحقق بـ schema (M9).
- بذرة حزمة الأشعة هي `docs/reference/DATA_DICTIONARY.md` (الأعمدة مع أسمائها العربية ومعناها في ZATCA).
- `riskLevel` يُعلَن `ordinal: false` صراحةً، لأن مستويات «المستوى» الأربعة تصنيفية لا ترتيب خطورة بينها (CLAUDE.md).
- بيانات Excel المرفوعة بلا حزمة تُعامل كحزمة «مؤقتة» يولّدها المحرك من إعلان الأنواع. جذر التتبع (provenance root) هو إعلان المستخدم، والربط بالقاموس اختياري. هذا يحل التعارض بين المواصفة 4.2 (لا measure على عمود غير مربوط بالقاموس) وطلب المالك الجديد (أي Excel).

### 4.2 العلاقات (Relationships)

- v1: علاقات one-to-many باتجاه فلترة واحد فقط، من dimension إلى fact، معرَّفة بعمود مفتاح واحد في كل جهة. لا many-to-many ولا bidirectional في v1.
- نموذج الأشعة الثابت: fact واحد (الفحص) مع dimensions: المنفذ، التاريخ، الموظف، المستوى، CertScan/NonCertScan.
- Excel مرفوع يصبح fact أو dimension إضافياً يربطه المستخدم بمفتاح. فشل الربط (مفاتيح مكررة في جهة «الواحد») يُرفض بالرسالة.

### 4.3 المقاييس (Measures) ولغة صيغ آمنة

**تعريف measure:**

```json
{
  "id": "certScanShare",
  "label": "نسبة CertScan",
  "expr": "count(rows where certScan = true) / count(rows)",
  "format": "percent",
  "ast": { "op": "div", "args": [ { "op": "count", "filter": { "field": "certScan", "eq": true } }, { "op": "count" } ] }
}
```

- **لا eval ولا new Function.** النص يُحلَّل بـ jsep (مؤكد: jsep 1.6.0، MIT، آخر نشر 2026-10-11، 390 KB، بلا اعتماديات) إلى AST، ثم مُقيِّم خاص بنا يمشي على الـ AST مع قائمة بيضاء من الدوال ومراجع الأعمدة فقط. أي عقدة خارج القائمة ترفض التعبير كله.
- **الدوال المسموحة في v1:** sum, count, distinctCount, avg, min, max, percentOfTotal, ratio (measure / measure), runningTotal, rank, topN. plus «with filter» و «ignore filter» كمكافئ مبسط لـ CALCULATE. هذا يوسّع `aggregations.ts` الموجود (غير متحقق في هذه الجلسة أن قائمته الحالية هي count/distinctCount/sum/avg/min/max/percentOfTotal، من تقرير repo-fit) ويحافظ على سلوك `aggregateOrNull`: القيمة الفارغة تُعرض شرطة لا صفراً مختلقاً (M6).
- **نفس الـ AST يُترجَم إلى صيغ Excel** في ورقة الإحصائيات والمصدر (SUMIFS, COUNTIFS، أو pivot). هكذا تصبح M11 قابلة للفحص: المحرك يحسب من الـ AST، وExcel يحسب من الترجمة، وبوابة التطابق تقارنهما.
- **الحسابات على مستوى الصف (calculated columns)** تُعامل كخطوة processing مسجلة (ورقة خاصة بها في القسم المعالج، M12)، لا كـ measure.
- **البدائل المرفوضة ولماذا:** expr-eval (مؤكد: آخر نشر 2022-06-17؛ تحذير أمني 2025 غير متحقق)، mathjs (مؤكد: 9.4 MB unpacked)، alasql (مؤكد: 10 MB)، DuckDB-WASM (مؤكد: 149 MB unpacked، ويعمل كـ worker + wasm تحت file:// وهذا خطر غير مختبر). chevrotain (مؤكد: 13.2.0، Apache-2.0، 2026-08-01) خيار لاحق إن احتجنا نحواً أغنى من jsep.
- **المحرك الحسابي:** في v1 تجميعات TypeScript بسيطة داخل worker (نمط `populationQueryWorker.ts` الموجود)، مع إبقاء طبقة الاستعلام مجردة ليُستبدل الخلف لاحقاً بـ Arquero (مؤكد: 8.0.3، BSD-3، 2.7 MB؛ لكن اعتمادية acorn وتجميعها للتعبيرات إلى دوال غير متحقق ويجب فحصه قبل الاعتماد).

### 4.4 ذكاء الزمن (Time Intelligence)

- جدول تواريخ مولَّد من المحرك (يوم، شهر، ربع، سنة، سنة مالية اختيارية) يُربط بأي عمود temporal.
- v1 يدعم: تجميع حسب grain، الفترة السابقة (month over month)، الفترة نفسها من السنة السابقة، من بداية السنة. كلها measures مسماة لا صيغ حرة.
- الفجوات في التواريخ تُملأ بقيمة فارغة (شرطة) لا بصفر.

### 4.5 الحدود (M13)

ثوابت معلنة في الوحدة: صفوف لكل dataset، فئات لكل رسم (فوقها top N + «أخرى»)، خلايا لكل صفحة جدول (فوقها «يتبع»)، شرائح لكل تقرير، ميزانية زمن لكل إصدار. تجاوز الحد رسالة واضحة لا تعليق.

---

## 5. مواصفة الـ visual (Visual Spec) والتعيين إلى الصيغ

### 5.1 `ReportSpec` (ينتجه البابان)

```json
{
  "schemaVersion": 1,
  "reportId": "uuid",
  "title": "تقرير منفذ جدة",
  "theme": "deck3",
  "datasets": [ { "datasetId": "pop", "source": "upload|host", "columns": [ "..." ] } ],
  "model": { "packId": "xray", "relationships": [ "..." ], "measures": [ "..." ] },
  "params": [ { "id": "month", "value": "2026-05" } ],
  "pages": [
    {
      "pageId": "p1", "designNo": 4, "size": "16:9", "grid": { "cols": 24, "rows": 14 },
      "filters": [ { "field": "portName", "in": [ "جدة" ] } ],
      "visuals": [
        {
          "visualId": "v1", "type": "barChart",
          "frame": { "col": 1, "row": 2, "w": 12, "h": 8, "z": 1 },
          "wells": {
            "axis":   [ { "field": "riskLevel" } ],
            "legend": [ { "field": "certScan" } ],
            "values": [ { "measure": "inspectionCount" } ]
          },
          "sort": { "by": "inspectionCount", "dir": "desc" },
          "limit": { "topN": 8, "others": true },
          "format": { "tone": "primary", "labels": "outside" }
        },
        { "visualId": "s1", "type": "slicer", "frame": { "..." : 0 }, "field": "portName", "syncPages": [ "p1", "p2" ] }
      ],
      "interactions": [ { "from": "s1", "to": "v1", "mode": "filter" } ]
    }
  ],
  "bookmarks": [ { "id": "default", "pageId": "p1", "filters": [ "..." ], "slicers": [ "..." ] } ]
}
```

- **كل نوع visual يعلن schema للـ wells:** الأدوار، الأنواع المقبولة (number / text / date / measure)، العدد الأدنى والأقصى. مثلاً `lineChart.axis` يقبل temporal أو ordinal فقط. الربط يُتحقق عند الحفظ وعند الإصدار.
- **الألوان بالـ tokens فقط** (`tone: primary|neutral|good|bad`)، لا hex. يتوافق مع `check:hex-literals` و M10.
- **المواقع بوحدات شبكة** لا بكسل، فالـ snap دقيق والتخطيط حتمي (M13 deterministic).
- **مُوصي حتمي (Show Me):** من أنواع الحقول المختارة وعددها يرتب أنواع الـ visuals الممكنة ويظهر اختياره ليُغيَّر. لا LLM يخترع أرقاماً.

### 5.2 التحليل (Resolve)

لكل visual يبني المحرك `Query = { datasetId, groupBy: wells.axis+legend+rows+columns, measures: wells.values, filters: report+page+visual+bookmark, sort, limit }`، ينفذه في worker، ويُخرج `ResolvedVisual = { series, categories, cells, totals, provenance[] }`. الـ totals تُحسب بإعادة تقييم الـ measure بدون فلتر الخلية، لا بجمع الخلايا. كل خلية تحمل `provenance = { datasetId, measureId, filters }` وهو ما تُكتب منه ورقة «المصدر» (M3).

### 5.3 التخطيط (Layout)

`ResolvedVisual` + `frame` + tokens deck3 تدخل في نموذج تخطيط مطلق مُقاس مسبقاً (قرار المالك 1): كل صندوق نص يُقاس بسلم الملاءمة (M7)، كل جدول يُقسَّم صفحات «يتبع»، وتُنتج شجرة `LayoutTree` بهندسة مطلقة نهائية. تُحسب مرة واحدة.

### 5.4 التعيين إلى الصيغ

| عنصر Spec | HTML | PowerPoint (PPTX) | Excel (XLSX) |
|---|---|---|---|
| page | `<section>` بأبعاد 16:9 ثابتة | slide | ورقة موضوع، مع pivot لكل visual في «الإحصائيات» |
| text / kpi | div مطلق الموضع | text box أصلي، `rtl="1"`، `algn="r"`، أرقام لاتينية في runs LTR (M5) | خلية مُنسقة ورابط إلى مصدرها |
| barChart / lineChart | SVG أصلي (كما في p-charts الحالية) | chart أصلي مع بيانات مضمَّنة قابلة للتحرير (M4) | pivot + chart مرتبط بالـ pivot |
| table / matrix | `<table>` مع «يتبع» | جدول أصلي، نفس تقسيم الصفحات | جدول Excel منظم (table object) + pivot |
| slicer | عنصر تفاعلي | لا يُرسم؛ يُطبق كـ bookmark state | slicer أصلي مرتبط بالـ pivot (مطلوب في M3 «filters and slicers») |
| image / logo | img | picture (الوحيد المسموح كصورة، M4) | صورة أعلى اليمين |
| theme | CSS tokens | theme XML + خط Somar مضمَّن | تعبئة الخلفية وخط Somar |

- **PDF** يُشتق من HTML بنفس شجرة التخطيط (`pdfPrintable`).
- **بوابة التطابق (M2):** لكل صندوق نص وخلية جدول، عدد الأسطر متساوٍ والزاوية العليا اليسرى ضمن 2px بين HTML و PPTX، وإلا يتوقف الإصدار.
- **بوابة الأرقام (M11):** كل رقم على شريحة يُقارن بقيمة الـ pivot المقابلة (محسوبة من الـ AST نفسه)، وأي فرق يوقف الإصدار. المتصفح لا يقرأ pivot من Excel، لذا التعريف الواحد هو الضمان، والفحص الخارجي عبر COM في T8 (غير متحقق في هذه الجلسة؛ من `poc/xlsx/`).

---

## 6. ما نعيد استخدامه من Report Designer وما نعيد بناءه

(الملاحظات التالية من تقرير repo-fit؛ لم تُعَد قراءة الملفات في جلسة التحقق، فهي **غير متحققة** هنا رغم أنها مُسندة إلى أسطر محددة.)

### 6.1 يُعاد استخدامه

| ما هو | أين | كيف |
|---|---|---|
| قشرة المحرر: Canvas, Inspector, FieldsPanel, VizPanel, PagesBar, Ribbon, useCanvasInteractions | `src/components/Sidebar/Tabs/ReportDesigner/editor/` | تبقى القشرة، وتُستبدل محتوياتها لتحرر `ReportSpec` بدل v1 |
| السحب من الحقول إلى الـ canvas ونافذة اختيار التجميع (FieldDropDialog) | TabView.tsx | نمط السحب (payload `application/x-rd-field`) يبقى؛ النافذة تُعاد كتابتها بالـ tokens (فيها hex مباشر اليوم) |
| نموذج wells في v1 `ChartConfig {axis[], legend?, values[{field, agg}]}` و Filter ops | `src/data/reportDesigner/reportTypes.ts` | يُرقى إلى wells المُعلَنة لكل نوع (5.1) |
| `aggregate` / `aggregateOrNull` | `query/aggregations.ts` | أساس المُقيِّم؛ يُوسَّع بالدوال في 4.3 |
| التخزين CAS: `designs.index.json` + ملف لكل تصميم تحت `4-reports/designs/` | `storage/reportDesignStorage.ts` | يبقى، مع إضافة `schemaVersion` ووحدة migration صريحة (سياسة ما بعد الإطلاق في CLAUDE.md) |
| `blockSanitize` (قوائم بيضاء للنص والـ tones) | `blocks/` | نمط fail-closed يُعمَّم على كل حدود الإدخال |
| قارئ Excel والنص الملصوق `SourceTable`، وأفكار `autoDetectMapping` و `findMappingIssues` | `src/data/adhocImport/` | القارئ يُعاد استخدامه؛ الربط يُنسخ كنمط في نواة محايدة ولا يُستورد (M9) |
| workers: `workbookWorker.ts`, `populationQueryWorker.ts` | `src/workers/` | النمط نفسه لـ resolve و emit |
| deck3 kit و tokens و Somar | `src/data/reporting/executive/deck3/` | الهوية البصرية الوحيدة (M10) |
| `DATA_DICTIONARY.md` | `docs/reference/` | بذرة حزمة xray |

### 6.2 يُعاد بناؤه من الصفر (قاعدة المالك: أعد البناء حين يكون الحفاظ أثقل)

1. **كتالوج الحقول** `query/fieldCatalog.ts`: 24 حقلاً ثابتاً كلها dimension ولا measure. يُستبدل بـ DatasetDef + Domain Pack.
2. **خطوة أنواع الأعمدة:** غير موجودة؛ `AdhocFieldKind` بلا number ولا boolean. تُبنى جديدة.
3. **رسم الجدول والرسم البياني في الـ canvas:** اليوم يسقطان إلى placeholder، و VizPanel لا يعرض chart ولا table. هذه الفجوة تُسد أولاً وعلى نموذج التخطيط الجديد لا على الـ string renderers.
4. **كتل V2 الساكنة (11 كتلة `bindingShape: "static"`)** و`BlockDefinition.render(...) => string`: الطبقة التي يستبدلها قرار المالك 1، لا تُمدَّد.
5. **مصدر البيانات الوحيد `ExecutiveRowsProvider` (الشهر المختار فقط):** يصبح مجرد host adapter يبني datasets ويستدعي الباب البرمجي.
6. **geometry.ts (snap/resize/hitTest فقط):** يُضاف guides و align و distribute و undo فوق وحدات الشبكة.
7. **التصدير:** لا يوجد اليوم سوى PrintView؛ خط الأنابيب الرباعي يُبنى جديداً فوق PoC الـ pptx والـ xlsx.
8. **ألوان hex وأنماط `ElementStyle` الحرة في v1:** تُزال لصالح tokens.

---

## 7. الاتساق مع المبادئ M1 إلى M14

| المبدأ | كيف يحققه التصميم |
|---|---|
| M1 أربع صيغ معاً | `issueReport` لا يملك مخرجاً جزئياً؛ البابان يستدعيانه فقط |
| M2 تطابق التخطيط | شجرة تخطيط واحدة مُقاسة مسبقاً تغذي HTML و PDF و PPTX؛ بوابة عدد الأسطر و 2px |
| M3 Excel هو البيانات الخام | provenance في كل خلية محلولة تُكتب في «المصدر»؛ pivots من الـ AST نفسه؛ slicers و buttons كأشكال |
| M4 أصلي قابل للتحرير | charts و tables و text boxes أصلية؛ الصورة فقط للشعار وصور المستخدم |
| M5 RTL افتراضياً | renderer الـ PPTX يفرض `rtl="1"` و `algn="r"` و runs LTR للأرقام اللاتينية |
| M6 لا أرقام مختلقة | كل رقم = measure مسجل أو حقل مربوط؛ المُقيِّم يرفض أي عقدة خارج القائمة البيضاء؛ `aggregateOrNull` يعطي شرطة لا صفراً |
| M7 نص كامل لا يُقص | سلم الملاءمة في مرحلة Layout؛ «يتبع» للجداول |
| M8 قواعد التصميم | lint يعمل في بوابة الإصدار على `LayoutTree` ذاتها لا على كل صيغة |
| M9 نواة محايدة | الحزم بيانات JSON؛ لا استيراد من كود الأشعة؛ ad-hoc يُنسخ نمطاً |
| M10 هوية واحدة | tokens فقط في الـ spec؛ Somar مضمَّن في PPTX و XLSX |
| M11 خام ثم workbook ثم شرائح | الترتيب في `issueReport` ثابت: resolve ثم xlsx ثم parity ثم html/pptx |
| M12 قسم خام ثم معالج | DatasetDef يحفظ الأعمدة كما رُفعت؛ كل خطوة تحويل مسجلة ورقة؛ بوابة reconciliation |
| M13 موثوقية | schema عند كل حدود، حدود معلنة، worker بميزانية زمن، حتمية بالـ snapshot، اختبارات إدخال عدائي |
| M14 الكتالوج والاختيار بالأرقام | `designNo` ثابت في كل page؛ التصميم المتقاعد يحتفظ برقمه ويُرفض برسالة |

---

## 8. خارطة الطريق المرحلية والقرارات المفتوحة

### 8.1 المراحل

**المرحلة 0 (جارية): PoC الـ PPTX والـ XLSX** (قرار المالك 2 و T8). لا تبدأ المرحلة 1 قبل أن يُفتح KPI slide + chart أصلي + جدول عربي في PowerPoint ويطابق HTML، وتُثبت الـ pivots في Excel.

**المرحلة 1: النواة الصامتة (headless core).**
- DatasetDef و schema الأنواع و profile الأعمدة.
- Domain pack schema + حزمة xray من القاموس.
- المُقيِّم على AST (jsep) بالقائمة البيضاء، وترجمته إلى صيغ Excel.
- Query → Resolve في worker مع الحدود.
- اختبارات: snapshot حتمية، إدخال عدائي (فارغ، صف واحد، nulls، نص عربي طويل، أرقام مختلطة، أعمدة مكررة، أنواع خاطئة).

**المرحلة 2: نموذج التخطيط والمُصدِّرات.**
- `LayoutTree` مُقاس مسبقاً، سلم الملاءمة، «يتبع».
- renderers: HTML، PDF، PPTX، XLSX من الشجرة نفسها.
- البوابات: figure parity، layout parity، lint، reconciliation، OOXML self-check.
- تعبير تقرير منفذ جدة بالـ `ReportSpec` كاختبار قبول (مواصفة 5.1).

**المرحلة 3: الباب البرمجي في التطبيق.**
- host adapter يبني datasets من الشهر المختار ويستدعي `issueReport`.
- الكتالوج المرقّم (15 إلى 20 تصميماً من deck3) والإصدار بأرقام الشرائح (M14).

**المرحلة 4: الباب البشري، الحد الأدنى.**
- تبويبة «التقارير»: رفع Excel، شاشة الأنواع، لوحة الحقول، canvas بالشبكة، wells المُعلَنة، slicers وفلاتر، bookmarks، الإصدار.
- أنواع v1: card, kpi, barChart, lineChart, pie/donut, table, matrix, text, divider, image, slicer.
- صلاحيات author / run / view.
- `schemaVersion` + وحدة migration من v1 designs مع أرشفة الأصل (سياسة ما بعد الإطلاق).

**المرحلة 5: الذكاء والتوسعة.**
- المُوصي الحتمي (Show Me)، field parameters (slicer يبدّل المقياس)، ذكاء الزمن الكامل، العلاقات بين datasets مرفوعة متعددة، محرك حسابي أثقل (Arquero) إن قاسه `check:bundle-size` ودلتا `Measure (pr)` مقبولين.

### 8.2 قرارات مطلوبة من المالك

1. **تعارض المواصفة مع نفسها حول PPTX:** الأقسام 1 و 3 والسؤال المفتوح 3 تقول «خارج النطاق»، والقسم 0 (القرار 7) و M1 تقول إلزامي. الاقتراح: تعديل النص القديم ليطابق القسم 0 (القسم 0 يعلن أنه الأعلى).
2. **الصيغ الحرة (custom formulas):** المواصفة 4.4 تستبعدها، والطلب الجديد يريدها. الاقتراح: نعم ضمن اللغة الآمنة في 4.3 فقط (AST بقائمة بيضاء، لا eval)، ولا DAX كامل.
3. **الربط بالقاموس إلزامي أم اختياري؟** المواصفة 4.2 تقول «لا measure على عمود غير مربوط». الاقتراح: جذر التتبع هو إعلان المستخدم للأنواع، والقاموس يفتح measures الحزمة فقط.
4. **حفظ لقطات Excel المرفوعة تحت `4-reports/datasets/`** (السؤال المفتوح 1): يلزم للإعادة والحتمية، لكن الحجم (ملف 318 MB في مثال المنفذ) يفرض قرار تجزئة أو ملف مصاحب.
5. **من يملك الباب البشري:** هل الموظف العادي يؤلّف، أم فقط supervisor فأعلى، والموظف يشغّل قالباً جاهزاً على Excel جديد؟
6. **المحرك الحسابي:** TypeScript بسيط في v1 (بلا اعتمادية) أم Arquero من البداية؟ يحتاج قياس دلتا الحزمة لا رقم unpackedSize.
7. **الحدود الرقمية في M13** (صفوف، فئات، شرائح، ميزانية الزمن): أرقام فعلية تُعلن في الوحدة.
8. **التفاعل في HTML:** هل يحتفظ HTML المُصدَّر بـ slicers تفاعلية (يتطلب تضمين البيانات والمُقيِّم في الملف)، أم HTML ثابت على حالة bookmark كما PPTX؟ التفاعل يزيد الحجم ويضيف مساراً حسابياً ثانياً يجب أن يطابق الأول.

### 8.3 ما يجب التحقق منه قبل دخول المواصفة كحقيقة

- كل ادعاءات Power Query و DAX و star schema و themes و slicers و bookmarks و interactions (لم تُجلب صفحاتها).
- حد 50 صفحة / 250 MB لتصدير PDF (لم تُجلب الصفحة).
- التحذير الأمني لـ expr-eval، واعتمادية acorn في Arquero وتجميعها للتعبيرات، واعتمادية jQuery في pivottable.
- PBIR «ملف لكل visual»، وقائمة renderers في SSRS، وتشغيل Stimulsoft في المتصفح.
- كل ملاحظات repo-fit عن الملفات والأسطر (Canvas placeholder، 24 حقلاً، V2 غير موصول، hex في FieldDropDialog).