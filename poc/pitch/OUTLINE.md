# Report engine pitch: content outline

Audience: the owner (decision maker). Language: Arabic, Latin digits. Built with the real deck3 kit.

Hard rules (spec §4.9): no long dash (— or –) anywhere; no emojis or symbols (✓ ★ ⚠ arrows); no eyebrow above every title (use `hideEyebrow: true` on content slides; eyebrows only on section dividers); titles state the finding; one focal element per slide; colour never carries meaning alone; only real figures (below), anything illustrative labelled «بيانات توضيحية».

Sources to read for facts: docs/superpowers/specs/2026-11-01-report-engine-design.md, docs/research/2026-11-05-pptx-fidelity-research.md, docs/research/2026-11-05-report-engine-ideas.md, poc/pptx/RESULTS.md.

## Slides

1. Cover: «محرك التقارير: من تقرير مبني يدويًا إلى منصة قوالب» , نوفمبر 2026.
2. Contents (deck3 contents slide).
3. Section divider 01 «المشكلة».
4. Title: «التقارير اليوم تُبنى بالكود، وكل تقرير جديد يبدأ من الصفر». Five facts from ideas §2: no layout engine (fixed row heights, long tables clipped silently), header wraps to 2 to 4 lines (port-report CSS overrides deck3 nowrap rule), designs live in code, only 2 chart forms, X-ray logic mixed into the engine.
5. Title: «الباوربوينت يطلع مختلف لأن المتصفح هو اللي يرتب الصفحة». 4 causes from pptx research §1 (flex/grid, CSS charts, WOFF font, RTL and insets).
6. Section divider 02 «القرار».
7. Title: «ستة قرارات اتخذتها في 5 نوفمبر» , the six owner decisions in spec §0, as a table.
8. Title: «نموذج ترتيب واحد يطلع منه HTML وPDF وPowerPoint بنفس الأرقام». Diagram: layout model (boxes in px) feeding three outputs; 1920x1080 px = 12,192,000 x 6,858,000 EMU, 6350 EMU per px.
9. Section divider 03 «الإثبات».
10. Title: «التجربة نجحت: الملف قابل للتعديل والترتيب مطابق». KPI band with real PoC figures: 6 of 8 criteria pass, table width difference 0 EMU, pixel difference 4.14%, library 154 KB gzip. Then P1 to P8 table from RESULTS.md (pass / partial in words).
11. Title: «نفس السلايد في الطرفين» , embed poc/pptx/out/html.png and poc/pptx/out/pptx.png side by side as base64 img (label each: HTML / PowerPoint).
12. Title: «أربع تصحيحات تعلمناها من التجربة» , the 4 findings (pt = px x 0.5; Chinese charset attributes break digits; number-only text needs rtl=0; table margin units).
13. Section divider 04 «المحرك».
14. Title: «ثمان قدرات تصنع المحرك» , feature list: data binding (app data + Excel mapped to dictionary), parameters (port, month), block library in deck3 identity, layout constraint engine, chart forms by data shape, catalog, design lint, export HTML/PDF/PPTX/XLSX.
15. Title: «الكتالوج: تصميم مرقم تختاره برقمه» , catalog: 15 to 20 seed designs from deck3, stable numbers by family (COV, KPI, OBS, CMP, TRD, TBL...), exported HTML lookbook, favourites, departments send a picks file plus Excel, admin builds.
16. Title: «شكل الرسم يتحدد من شكل البيانات» , chart forms: profiler (count of items, series, time vs category), rules table, auto with a visible reason, owner override; examples 1 to 5 items, 6 to 14, 15 to 30 ranked, 30+ top N plus «أخرى», comparisons of 2, 3, 5 ports.
17. Title: «الجدول الطويل ينتقل لسلايد «يتبع» بدل ما ينقص» , layout constraint engine: single-line header with fit, shrink, abbreviate; measure before render; pagination with repeated header; minimum font 20px.
18. Title: «قواعد تمنع الشكل الآلي» , design rules from spec §4.9: Floor, Reflex, Finish, Text tiers with 2 to 3 examples each.
19. Title: «كل رقم في التقرير له مصدر» , traceability: Excel columns matched to the data dictionary, a measure can only use mapped fields, provenance per figure, deterministic snapshots.
20. Title: «المحرك مستقل والمجال حزمة» , domain packs: X-ray is one pack, tax and cases later; engine boundary src/engine; extraction to a separate system later.
21. Title: «اختبار القبول: تبني تقرير منفذ جدة بيدك» , acceptance test from spec §5.1: 15+ slides, 9 capabilities, zero figure difference allowed.
22. Section divider 05 «الخطة».
23. Title: «خمس مراحل، نبدأ بإصلاح الهيدر» , roadmap from ideas §4 (phase 0 days, 1: 3 to 5 weeks, 2: 3 to 4 weeks, 3: 4 to 6 weeks, 4 later), note «المدد تقدير».
24. Title: «المخاطر التي نعرفها» , risks: Somar must be installed machine-wide on every PC or PowerPoint substitutes it (PoC P7); bundle grows about 154 KB gzip; existing Report Designer designs need a migration with archive; effect-timing bugs history means test-first and review.
25. Title: «قرارات ما زالت مفتوحة» , open: font strategy (install Somar on all PCs or use an Office Arabic font in both outputs); PDF via browser print as a permanent constraint; measures as registered functions only; who may edit templates; is uploaded Excel stored in the workspace; P5 pixel threshold after the font fix.
26. Title: «المطلوب منك الآن» , three asks: decide the font strategy; approve phase 0 (header fix); approve re-planning P1 on the new layout model.
27. Closing (deck3 closing slide, org block).
