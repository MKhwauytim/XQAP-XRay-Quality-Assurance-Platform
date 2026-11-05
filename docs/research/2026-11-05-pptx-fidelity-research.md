# تقرير بحثي نهائي: تصدير تقرير deck3 إلى PowerPoint أصلي قابل للتحرير بنفس هوية HTML/PDF

**التاريخ:** 2026-11-05
**النطاق:** `src/data/reporting/executive/deck3/` (theme.ts 599 سطرًا، slideKit.ts 459، chartKit.ts 173، slides.ts 1341) في مستودع `x-ray-quality-app-v1`
**القيود الثابتة:** SPA بلا backend، يُبنى إلى ملف `dist/index.html` واحد عبر `vite-plugin-singlefile`، يُفتح من مشاركة Windows عبر `file://`، Chromium فقط، سقف الحزمة 30 MB raw / 10 MB gzip (`scripts/check-bundle-size.mjs`, MAX_BYTES / MAX_GZIP_BYTES، مؤكد بالقراءة).

**مفتاح التمييز:** ما كُتب كحقيقة هنا مؤكد (CONFIRMED) من المصدر أو من قراءة ملفات المستودع في هذه الجلسة. كل ما سواه معلَّم صراحة **[غير مؤكد]**. لم يُشغَّل أي بناء ولم يُفتح أي ملف PPTX في PowerPoint خلال هذا البحث.

---

## 1) لماذا يفشل إخراج PowerPoint كل مرة؟

السبب الجوهري: **deck3 يترك المتصفح يقرر الهندسة النهائية**، بينما PPTX (OOXML/DrawingML) لا يملك أي محرك تخطيط. كل ما ليس محددًا بالأرقام مسبقًا يُعاد اشتقاقه في PowerPoint بنتيجة مختلفة أو يُحذف.

| # | السبب | الدليل | أثره في PowerPoint |
|---|-------|--------|---------------------|
| 1 | **Layout بـ flex/grid** | `theme.ts`: 101 تطابقًا لكلمة `flex` (مؤكد بـ grep هذه الجلسة؛ رقم 155 الوارد سابقًا لم يتكرر)، وقواعد `grid-template-columns` متعددة | لا يوجد مكافئ لـ flex/grid/gap في OOXML. المحوِّل إما يخمن المواضع أو يسقطها |
| 2 | **الرسوم البيانية CSS وليست بيانات** | `chartKit.ts`: الأعمدة `div.v3-bar` بارتفاع `%` من `scalePct(value,min,max)` على محور ثابت لكل رسم، خطوط مرجعية بـ `bottom:%`، القيم الفارغة فجوة لا عمود صفري (مؤكد بالقراءة) | تحويل DOM يخرجها كمستطيلات (غير قابلة للتحرير). الرسم الأصلي يحتاج بناءً من البيانات لا من الـ DOM |
| 3 | **الخط Somar مضمَّن كـ WOFF** | `theme.ts` سطور 16-19: أربعة `@font-face` (300/400/500/700) WOFF base64؛ سطر 41: stack `Somar, IBM Plex Sans Arabic, Tahoma, Arial` (مؤكد) | PowerPoint لا يقرأ WOFF. PptxGenJS **لا يضمّن خطوطًا** (مؤكد من مصدر `gen-xml.ts`). الجهاز الذي لا يحوي Somar يستبدله بخط عربي آخر بعروض وارتفاعات مختلفة → تنكسر الأسطر وتتغير الكتل |
| 4 | **إعادة لفّ النص (text reflow)** | PowerPoint يكسر الأسطر بمحركه الخاص ومقاييس خطه | فقرة تمتد سطرين في Chromium قد تصير ثلاثة في PowerPoint |
| 5 | **Autofit و insets الافتراضية** | ECMA-376 §21.1.2.1.1: `bodyPr` افتراضيًا lIns/rIns = 91440 EMU وtIns/bIns = 45720 EMU؛ PptxGenJS يُصدر هذه القيم في master الخاص به (مؤكد) | كل مربع نص يحصل على هامش داخلي ~0.1″/0.05″ لا وجود له في CSS، وقد يُقلَّص الخط إن تُرك normAutofit |
| 6 | **تباعد الأسطر بنموذج مختلف** | CSS `line-height` يوزّع half-leading؛ OOXML `a:lnSpc` يقبل `spcPct` أو `spcPts` (مؤكد في المواصفة). **[غير مؤكد]** أن `line-height:1.15` ≠ `spcPct 115%` عمليًا، لم يُقَس | الكتل النصية تطول أو تقصر عن HTML |
| 7 | **RTL وثنائية الاتجاه** | `a:pPr` يحمل خاصية `rtl` (مؤكد). `.v3-page-num` معزول LTR في HTML | بدون `rtl="1"` + `algn` + `lang="ar-SA"` + خط `a:cs` تنعكس الأرقام والنسب داخل النص العربي. **[غير مؤكد]** أن `rtl="1"` بدون `algn="r"` يُلصق النص يسارًا (مصدره صفحة طرف ثالث) |
| 8 | **عناصر CSS بلا مكافئ** | `::before` نقاط العناوين، `filter:brightness(0) invert(1)` للشعار، `transform:translateY`، `letter-spacing` بـ em، `rgba` | تحتاج ترجمة يدوية (ellipse، أصل شعار أبيض، إحداثيات محسوبة، `spc` بمئات النقطة، hex مُمزوج مسبقًا) |

**[غير مؤكد، استنتاج]**: الافتراض بأن المحاولات السابقة اعتمدت تحويل DOM أو إعدادات عامة. لا دليل لدينا عن تلك المحاولات، لكن كل سبب في الجدول أعلاه ينتج "يبدو مختلفًا وأسوأ" بغض النظر عن الأداة.

---

## 2) مقارنة الخيارات

### 2-أ) الاستراتيجية المعمارية

| الخيار | الفكرة | الدقة البصرية (fidelity) | قابلية التحرير | الجهد | الحكم |
|--------|--------|--------------------------|----------------|-------|-------|
| **(a) نموذج تخطيط واحد → ثلاثة مُخرِجات** | يُحسب كل صندوق بإحداثيات مطلقة (EMU) مرة واحدة في الكود؛ HTML يُرسم بـ `position:absolute`، وPPTX يستخدم نفس الأرقام `a:off/a:ext`؛ الرسوم تُبنى من نفس البيانات ومحور واحد | **عالية بالبناء**، التطابق مضمون تصميميًا لا بالمصادفة | كاملة: نص حقيقي، جداول `a:tbl`، رسوم `c:chart` بمصنف مضمَّن | كبير مقدمًا: إعادة كتابة طبقة التخطيط في deck3 من flex/grid إلى صناديق مقيسة | **الموصى به** |
| (b) قراءة DOM الحي وتحويله (`getBoundingClientRect` + `getComputedStyle`) كما تفعل dom-to-pptx | المواضع مجانية من المتصفح | متوسطة: المواضع صحيحة لكن النص يُعاد لفّه، والرسوم CSS تخرج أشكالًا، وpseudo-elements/clip تُخمَّن | جزئية: الرسوم ليست رسومًا أصلية | متوسط | مناسب كأداة bootstrap أو oracle للاختبار، ليس كمنتج |
| (c) بناء PPTX أولًا ثم عرضه HTML عبر renderer في المتصفح | مصدر واحد هو PPTX | HTML/PDF يصير هو المنحرف (الـ renderers تقريبية) ويُفقد deck3 الحالي | كاملة | كبير + فقدان الهوية الحالية | مرفوض |

### 2-ب) المكتبات (تحقق من npm registry وGitHub بتاريخ 2026-11-05)

| المكتبة | الإصدار/الرخصة | يعمل في المتصفح؟ | RTL / خط عربي | رسوم أصلية قابلة للتحرير | تكلفة الحزمة | ملاحظات |
|---------|---------------|------------------|---------------|---------------------------|--------------|---------|
| **pptxgenjs** | 4.0.1، MIT، نُشر 2025-06-26، unpacked 2,605,307 B (مؤكد) | نعم: حقل `browser` يعطّل fs/os/path/https/image-size (مؤكد). في المتصفح jszip هو الاعتماد الفعلي الوحيد. تنبيه: حقل `dependencies` يضم أيضًا `https` و`@types/node` (مؤكد) | `rtlMode` → `rtl="1"` على `a:pPr` (مؤكد، gen-xml.ts سطور 840/1266). `fontFace` يُكتب في `a:latin` و`a:ea` و`a:cs` معًا (مؤكد، سطر 998). **لا تضمين خطوط** (مؤكد) | نعم: يكتب `ppt/embeddings/Microsoft_Excel_Worksheet{id}.xlsx` و`<c:externalData r:id>` (مؤكد، gen-charts.ts 520/527/748) → "Edit Data" يجب أن يعمل **[غير مؤكد في PowerPoint فعليًا]** | **[غير مؤكد]** تقدير 150-250 KB gzip بلا قياس. يُضيف jszip كاعتماد جديد | الأساس الموصى به |
| dom-to-pptx | 2.1.2، MIT، 9,354,555 B unpacked (مؤكد) | يوجد `browser` bundle (مؤكد)، لكن اعتماداته تضم puppeteer ^25، html2canvas، opentype.js، fonteditor-core، pako (مؤكد) | غير موثق | لا (أشكال) | ثقيلة | مرجع كود فقط |
| pptx-automizer | 0.9.4، MIT، 1,391,374 B، بلا حقل `browser`، يعتمد على pptxgenjs **^3.12** لا 4 (مؤكد) | غير موثق للمتصفح |، | نعم (قوالب) |، | نهج "صمّم القالب في PowerPoint واملأه بالبيانات" ممتاز بصريًا، لكن المكتبة Node-oriented وعلى major أقدم |
| nodejs-pptx | 1.2.5، MIT، deps xml2js/xmlbuilder/jszip/uuid/image-size ^2 (مؤكد) | لا قصة متصفح واضحة |، |، |، | مرفوض |
| officegen / node-pptx / html2pptx | **[غير مؤكد، لم تُعَد مراجعتها]** 0.6.5 (2021) / 1.0.0 (2018، بلا رخصة) / 0.0.5 (2023) |، |، |، |، | مرفوضة لجمودها |
| **كتابة OOXML يدويًا + zip writer** | لا اعتماد خارجي (أو fflate/jszip صغيرة) | نعم | تحكم كامل: `a:cs`، `spcPts`، تضمين خط `.fntdata` ممكن نظريًا | نعم، مع كتابة `.xlsx` المضمَّن عبر SheetJS المُوَرَّد أصلًا (`vendor/xlsx-0.20.3.tgz`) | أصغر | أعلى تحكم وأعلى جهد؛ مفيد كـ post-processing فوق pptxgenjs لما لا يعرّضه |

**ملاحظة مستودع (مؤكد):** jszip وfflate غير مثبّتَين الآن؛ `src/data/storage/compressedEnvelope.ts` سطر 176 يذكر أن fflate قُيِّس واستُبعد عمدًا. إدخال pptxgenjs يُدخل jszip كاعتماد متعدٍّ جديد، يجب إبرازه في `Measure (pr)`.

---

## 3) النهج الموصى به والقواعد التي يفرضها على المحرك

### 3-أ) النهج

**(a) نموذج تخطيط واحد مقيس مسبقًا + pptxgenjs 4.0.1 ككاتب + post-processing بالـ zip لما لا يعرّضه pptxgenjs.** لا تحويل DOM. deck3 يُعاد بناء طبقة التخطيط فيه من flex/grid إلى **صناديق مطلقة** تحمل الأرقام نفسها للـ HTML والـ PPTX (توافقًا مع توجيه المالك "أعد الكتابة من الصفر إذا كان الحفاظ يعني كودًا أثقل").

### 3-ب) تعيين الوحدات (مؤكد حسابيًا)

- الشريحة 1920×1080 px (مؤكد: `.slide.v3 width:1920px;height:1080px`، و`@page{size:1920px 1080px}` سطر 597) → **12,192,000 × 6,858,000 EMU** = 13.333″ × 7.5″ (16:9) بمعامل **6350 EMU / px**. (رقم 9525 صحيح فقط عند تفسير px كـ 96 dpi حقيقي؛ هنا نستخدم 6350.)
- 914,400 EMU / inch (ECMA-376).
- حجم الخط: pt = px × 0.75 (عند 96 dpi) **[غير مؤكد كمطابقة بصرية، يحتاج قياسًا]**.

### 3-ج) قواعد نظام التصميم المفروضة على المحرك (البلوكات المسموحة فقط)

| القاعدة | التفصيل | لماذا |
|---------|---------|-------|
| **R1 لا تخطيط ديناميكي** | ممنوع flex/grid/gap/max-width/align-items:baseline داخل الشريحة. كل بلوك يعلن `x,y,w,h` بالـ px على شبكة 8px | OOXML لا يملك محرك تخطيط |
| **R2 بدائيات مغلقة** | فقط: `rect`/`roundRect` (نصف قطر موحد → `prstGeom adj`)، `ellipse`، `line`، `textBox` (صندوق ثابت، no autofit، insets = 0)، `table` (`a:tbl` بعرض أعمدة وارتفاع صفوف ثابتَين، تعبئة صلبة، حدود موحدة)، `image` (الشعار فقط)، `chart` أصلي (bar/column clustered أو stacked، line، pie/doughnut) | كل بلوك له مكافئ OOXML واحد-لواحد |
| **R3 ألوان hex صلبة فقط** | tokens deck3 مسطّحة أصلًا (`--v3-navy #10304f`، gold `#b48a3c`، blue `#3f6fa8`…). rgba يُمزج مسبقًا إلى hex. لا gradients (لا يوجد منها في deck3، مؤكد بـ grep سابق **[غير مُعاد تحققه هنا]**) | `srgbClr` مباشر |
| **R4 نص قصير ومقيس** | العناوين/التسميات/أرقام KPI سطر واحد أو سطور صريحة. يُقاس النص في المتصفح بـ `canvas.measureText` بنفس خط التصدير + هامش أمان؛ **البناء يفشل** إذا تجاوز النص صندوقه. الفقرات الطويلة تُكسر صراحة (`a:br`) لا بالالتفاف | PowerPoint يلفّ بمحركه |
| **R5 تباعد أسطر بالنقاط** | `a:lnSpc/a:spcPts` بدل `spcPct`؛ **[غير مؤكد]** أن pptxgenjs `lineSpacing` يُصدر `spcPts`، يُفحَص في المصدر، وإلا يُحقن بالـ post-processing | يُحيّد اختلاف نموذج half-leading |
| **R6 RTL صريح على كل فقرة** | `rtl="1"` + `algn` (مرآة: `r` للمعتاد) + `lang="ar-SA"` + الخط في `a:cs` (pptxgenjs يفعل ذلك مع `fontFace`، مؤكد). الأرقام والنِّسب runs منفصلة، و`%` داخل الـ run. انعكاس x يدوي: `x' = W − x − w` | لا `dir=rtl` للمجموعات في OOXML |
| **R7 خط واحد بأوزان حقيقية** | PowerPoint يعرف `b=1` فقط؛ أوزان 300/500 تحتاج وجوه خط منفصلة (Somar Light / Medium كأسماء مستقلة) أو تُسقط. يُقرَّر إمّا تثبيت Somar TTF على أجهزة المشاهدة أو اعتماد خط Windows/Office (Tahoma / Segoe UI / Arial / Sakkal Majalla) **ومطابقة HTML له** | pptxgenjs لا يضمّن الخطوط (مؤكد) |
| **R8 الرسوم من البيانات لا من الـ DOM** | min/max/majorUnit محور واحد يُغذّي HTML (SVG أو CSS) والـ `c:scaling`. القيم الفارغة → نقاط `c:pt` غائبة + `dispBlanksAs gap`. الخطوط المرجعية → سلسلة line إضافية أو connector. ألوان الأعمدة لكل نقطة → `c:dPt`. RTL للمحور: `catAxisOrientation:'maxMin'` **[غير مؤكد في مصدر pptxgenjs، موثق فقط]** | قابلية تحرير حقيقية عبر المصنف المضمَّن |
| **R9 الزوائد غير الشريحة تُستثنى** | box-shadow الشريحة، deck-toolbar، `@media screen`، fullscreen، `font-display`، `tabular-nums` | ليست محتوى شريحة |
| **R10 بدائل للعناصر غير القابلة للتعيين** | `::before` نقطة → `ellipse`؛ `filter: invert` للشعار → أصل شعار أبيض مسبق؛ `letter-spacing` em → `spc` بمئات النقطة؛ `CHECK_SVG` → `custGeom` أو حرف أيقونة | مكافئ صريح لكل حالة |

### 3-د) الهيكل المقترح في الكود (وصفي، لا تعديل الآن)

```
deck3/
  layout/      ← نموذج الصناديق المطلقة (px) + tokens (hex, pt, grid 8px)
  render/html  ← يرسم الصناديق بـ position:absolute (يحل محل flex/grid)
  render/pptx  ← pptxgenjs + zip post-processing (spcPts, insets=0, noAutofit)
  charts/      ← محور واحد → HTML و c:chart
```

الألوان والخطوط تُستورد من `theme.ts` الحالي لا تُعاد تعريفها (قاعدة المستودع: لا تكرار للحالة).

---

## 4) الخطة المرحلية

### المرحلة 0، إثبات مفهوم (PoC) في فرع بحثي، لا يُدمج

**المحتوى:** شريحة KPI واحدة من deck3 + رسم أعمدة أصلي واحد + جدول عربي واحد، تُبنى من بيانات fixture ثابتة وتُصدَّر `.pptx` من داخل المتصفح (Chromium، بلا شبكة).

**معايير النجاح (كلها قابلة للتحقق في Windows PowerPoint على جهاز حقيقي):**

| # | المعيار | طريقة الفحص |
|---|---------|--------------|
| P1 | الملف يُفتح بلا "repair" في PowerPoint Windows | فتح يدوي |
| P2 | الرسم: "Edit Data" يفتح المصنف المضمَّن وتعديل قيمة يُحدِّث العمود | يدوي، يثبت ادعاء `externalData` فعليًا |
| P3 | النص العربي: تشكيل صحيح، اتجاه RTL، لا انعكاس في الأرقام والنِّسب، الأرقام لاتينية (0-9) كما في HTML | يدوي + فحص `rtl="1"`/`lang`/`a:cs` بفك الـ zip |
| P4 | الجدول: `a:tbl` حقيقي، عرض الأعمدة والصفوف يساوي HTML ± 1px ضمن 6350 EMU/px | فك الـ zip + مقارنة الأرقام |
| P5 | مطابقة بصرية: لقطة PowerPoint (PowerPoint COM أو تصدير PNG من PowerPoint) مقابل لقطة Chromium لنفس الشريحة؛ عتبة فرق pixel تُحدَّد بعد أول قياس (لا نعلن رقمًا الآن) | diff آلي؛ LibreOffice **ليس** مرجعًا لأنه يستبدل الخطوط |
| P6 | قياس كلفة الحزمة: Δ raw/gzip من `npm run build` + `check:bundle-size` | يُسجَّل الرقم الفعلي ويحلّ محل التقدير 150-250 KB غير المؤكد |
| P7 | قرار الخط موثَّق: Somar TTF مثبت على أجهزة الاختبار **أو** الخط البديل المُعتمد، مع HTML مُعاد ضبطه له | قرار المالك |
| P8 | فحص `lineSpacing` → `spcPts` و`maxMin` في مصدر pptxgenjs أو بفك الـ zip | grep على الملف الناتج |

**الحد الزمني:** إذا فشل P2 أو P3 بعد محاولة معقولة، يُعاد النظر في الأساس (OOXML يدوي بدل pptxgenjs) قبل أي استثمار أكبر.

### المرحلة 1، نموذج التخطيط في deck3 (HTML أولًا)

- بناء `layout/` بالصناديق المطلقة وtokens، وتحويل شرائح deck3 إليها شريحة بشريحة.
- **Snapshot أولًا** (`kitSnapshot.test.ts` موجود، مؤكد) ثم التغيير ثم diff؛ الهدف أن يبقى HTML/PDF مطابقًا بصريًا للحالي أو يُقَرّ الفرق صراحة.
- قياس النص في البناء + فشل عند التجاوز (R4).
- Tier 3 في سجل التعديلات (تغيير معماري).

### المرحلة 2، مُخرِج PPTX الكامل

- مُخرِج لكل بدائية في R2 + master/layout لكل تخطيط deck3 عبر `defineSlideMaster`.
- Snapshot لأجزاء XML الناتجة (ppt/slides/*.xml, ppt/charts/*.xml) كما تُسنَّد باقي builders المستودع.
- يُشغَّل في worker مضمَّن (`?worker&inline` كـ `workbookWorker`) لعدم حجب الواجهة.
- حلقة مطابقة بصرية (P5) لكل شريحة.

### المرحلة 3، التثبيت

- زر تصدير في تبويب Reports بنص عربي عبر `labelsStore.ts`.
- وثيقة قرار الخط وتعليمات نشره على أجهزة المشاركة.
- `npm run build` + كل بوابات Tier 3 قبل الـ PR.

---

## 5) المخاطر والأسئلة المفتوحة

| # | الخطر / السؤال | الحالة | التخفيف |
|---|-----------------|--------|---------|
| K1 | **الخط**: Somar WOFF غير قابل للاستخدام في PowerPoint، وpptxgenjs لا يضمّن (مؤكد). هل Somar متاح كـ TTF برخصة تسمح بالتضمين/التثبيت؟ | **مفتوح، أكبر خطر على "يبدو نفسه"** | قرار مالك مبكر (P7). البديل: خط Windows/Office وإعادة مطابقة HTML له |
| K2 | تضمين الخط داخل PPTX (`.fntdata`) | **[غير مؤكد]**: Microsoft تذكر أن التضمين TrueType/OpenType فقط، وأن أعلام الرخصة قد تمنعه، وأن Mac يدعمه من 16.17؛ المصادر تتعارض بشأن CFF .otf | إن لُزم: post-processing يدوي للـ zip، ويُختبر في PowerPoint Windows |
| K3 | الأرقام العربية-الهندية مقابل اللاتينية | **[غير مؤكد]**، لا مصدر؛ قد يتأثر بـ `lang` وإعدادات النظام | P3 يختبرها؛ استخدام ASCII digits في runs منفصلة |
| K4 | تفاعل `rtl="1"` مع `algn` | **[غير مؤكد]** (مصدر طرف ثالث) | إصدار الاثنين دائمًا |
| K5 | `spcPts` و`maxMin` في pptxgenjs | **[غير مؤكد]** في المصدر | P8 |
| K6 | "Edit Data" يعمل فعلًا | المسار في المصدر مؤكد؛ السلوك في PowerPoint **غير مؤكد** | P2 |
| K7 | كلفة الحزمة | **[غير مؤكد]** 150-250 KB gzip بلا قياس؛ السقف 10 MB gzip بعيد (مؤكد) | P6؛ قراءة Δ في `Measure (pr)` |
| K8 | إدخال jszip كاعتماد جديد رغم استبعاد fflate عمدًا سابقًا | مؤكد كواقعة | إبرازه في PR؛ البديل zip writer يدوي أو CompressionStream الأصلي |
| K9 | إعادة كتابة طبقة تخطيط deck3 قد تغيّر HTML/PDF الحالي | مخاطرة انحدار | snapshot أولًا + diff بصري + إقرار المالك لأي فرق |
| K10 | المطابقة البصرية لا يمكن أتمتتها في CI بلا PowerPoint | قيد بيئي | PowerPoint COM على جهاز Windows كـ oracle؛ LibreOffice smoke فقط |
| K11 | pptxgenjs: إيقاع إصدار بطيء، **[غير مؤكد]** ~6.35k نجمة و309 issues وآخر push 2025-11-28 | خطر صيانة | post-processing يدوي يقلّل الاعتماد على ميزات المكتبة الدقيقة |
| K12 | التقدير أن أسباب الفشل السابقة هي تحويل DOM | **[غير مؤكد، استنتاج]** | لا يؤثر على الخطة؛ R1-R10 تعالج كل مصدر انحراف معروف |

---

## المصادر

- npm registry: https://registry.npmjs.org/pptxgenjs · https://registry.npmjs.org/pptxgenjs/4.0.1 · https://registry.npmjs.org/dom-to-pptx · https://registry.npmjs.org/pptx-automizer · https://registry.npmjs.org/nodejs-pptx · https://registry.npmjs.org/officegen · https://registry.npmjs.org/node-pptx · https://registry.npmjs.org/html2pptx
- PptxGenJS: https://api.github.com/repos/gitbrent/PptxGenJS · https://gitbrent.github.io/PptxGenJS/docs/api-text/ · https://gitbrent.github.io/PptxGenJS/docs/api-charts/ · المصدر على master: `src/gen-xml.ts` (سطور 840، 998، 1266)، `src/gen-charts.ts` (سطور 520، 527، 748)
- ECMA-376 Part 1 (DrawingML): https://ecma-international.org/publications-and-standards/standards/ecma-376/، §21.1.2.1.1 bodyPr، §21.1.2.2.7 pPr، §21.1.2.2.5 lnSpc، §21.1.2.3.1 cs، §21.1.2.3.7 latin، §21.2 Charts · http://officeopenxml.com/drwSp-text-bodyPr.php · http://officeopenxml.com/drwParaProps.php
- Microsoft: https://support.microsoft.com/en-us/office/benefits-of-embedding-custom-fonts-cb3982aa-ea76-4323-b008-86670f222dbc · https://support.microsoft.com/en-us/office/2ba26947-5d18-4eb3-b5a9-67a58629e1b8 · https://learn.microsoft.com/en-us/previous-versions/office/office-12/ff762320(v=office.12)
- CSS Inline Layout L3: https://www.w3.org/TR/css-inline-3/#line-height-property · MDN measureText: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText · MDN getBoundingClientRect: https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect
- مصادر طرف ثالث (أقل سلطة): https://www.skillsdirectory.com/skills/asadeisa-arabic-pptx · https://bitbucket.org/okapiframework/okapi/issues/927/openxml-rtl-properties-not-correctly · https://docs.rs/crate/ppt-rs/latest/source/src/generator/text/rtl.rs · https://deckary.com/blog/powerpoint-fonts · https://www.indezine.com/products/powerpoint/learn/textandfonts/can-this-font-be-embedded.html · https://pptfaq.com/FAQ00076_Embedding_fonts.htm
- المستودع (مقروء في هذه الجلسة): `src/data/reporting/executive/deck3/theme.ts` (سطور 16-19، 32، 41، 63، 597)، `src/data/reporting/executive/deck3/chartKit.ts` (سطور 25-37، 65، 91، 109-160)، `scripts/check-bundle-size.mjs` (سطور 122-123)، `src/data/storage/compressedEnvelope.ts` (سطر 176)، `node_modules` (لا jszip/fflate/pptx)، `vite.config.ts`، `vendor/README.md`، `CLAUDE.md`