# Executive Report — Page HTML Skeletons

Reference for the Implementer agent. Each section shows the exact HTML structure
from `xray_executive_report_preview_v4.html` with `{{PLACEHOLDER}}` markers where
dynamic data is injected by the TypeScript page-builder functions.

CSS classes come from `src/data/reporting/executive/theme.ts`.  
Page builders live in `src/data/reporting/executive/pages/`.  
Assembly entry is `src/data/reporting/executive/assemble.ts`.

---

## PAGE 1 — الغلاف (Cover)

```html
<section class="page cover" id="page-cover" data-title="الغلاف">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الغلاف</div>
    <div class="rail-tab">الفهرس</div>
    <div class="rail-tab">الأجزاء</div>
  </div>
  <div class="page-inner">
    <div class="org">
      <div class="shield"></div>
      <div class="org-lines">هيئة الزكاة والضريبة والجمارك<br>قطاع الشؤون القانونية<br>الإدارة العامة لضمان الجودة والامتثال<br>إدارة ضمان جودة الأشعة اللاحقة</div>
    </div>
    <div class="title-block">
      <div class="kicker">نسخة تنفيذية</div>
      <h1>التقرير التنفيذي لضمان جودة الأشعة</h1>
      <div class="subtitle">تحليل مجتمع الحالات والعينة والتوزيع ومؤشرات الجودة</div>
      <div class="rule"></div>
      <p class="lead">دورة التقرير: {{REPORT_CYCLE}}<br>مجتمع الحالات محل الدراسة: {{POPULATION_MONTH}}</p>
      <div class="level-strip">
        <div style="--accent:var(--gold)">المستوى الأول</div>
        <div style="--accent:var(--blue)">المستوى الثاني</div>
        <div style="--accent:var(--slate)">المستوى الثالث</div>
        <div style="--accent:var(--coral)">المستوى الرابع</div>
      </div>
      <div class="badges">
        <span class="badge">سري داخليًا</span>
        <span class="badge">نسخة تنفيذية</span>
      </div>
    </div>
    <div class="page-no">01</div>
  </div>
</section>
```

**Placeholders:**
- `{{REPORT_CYCLE}}` — e.g. "يونيو 2026"
- `{{POPULATION_MONTH}}` — e.g. "مايو 2026"

---

## PAGE 2 — الفهرس (Table of Contents)

```html
<section class="page toc-page" id="page-toc" data-title="الفهرس">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الفهرس</div>
    <div class="rail-tab">الجزء الأول</div>
    <div class="rail-tab">الجزء الثاني</div>
    <div class="rail-tab">الجزء الثالث</div>
  </div>
  <div class="page-inner">
    <div class="toc-header">
      <div class="toc-title">
        <div class="small-note">التقرير التنفيذي لضمان جودة الأشعة<br>تحليل مجتمع الحالات والنتائج والتحاليل المتقدمة</div>
        <h2 class="section-title">الفهرس</h2>
        <div class="section-subtitle">هيكل التقرير التنفيذي</div>
      </div>
      <div class="org">
        <div class="shield"></div>
        <div class="org-lines">التقرير التنفيذي لضمان جودة الأشعة<br><span class="muted">تحليل مجتمع الحالات والنتائج والتحاليل المتقدمة</span></div>
      </div>
    </div>
    <div class="toc-grid">
      <div class="card">
        <div class="panel-title">المقدمة والمنهجية</div>
        <div class="table-wrap">
          <table>
            <tr><td>المعجم ودلالات المستويات</td><td>03</td></tr>
            <tr><td>الجزء الأول: مجتمع الحالات</td><td>04</td></tr>
            <tr><td>مجتمع حالات المخاطر</td><td>05</td></tr>
            <tr><td>المستويات والمنافذ</td><td>06</td></tr>
            <tr><td>العينة</td><td>07</td></tr>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">النتائج والتحليلات</div>
        <div class="table-wrap">
          <table>
            <tr><td>الجزء الثاني: نتائج الفحص</td><td>08</td></tr>
            <tr><td>نتائج الدقة حسب المنفذ</td><td>09</td></tr>
            <tr><td>نتائج الدقة حسب المستويات</td><td>10</td></tr>
            <tr><td>نتائج جودة الصور</td><td>11</td></tr>
            <tr><td>الأصناف المشبوهة</td><td>12</td></tr>
          </table>
        </div>
      </div>
      <div class="card appendix-card">
        <div>
          <div class="panel-title">الملاحق</div>
          <p>تفاصيل المنافذ، القواعد الحسابية، جودة البيانات، معجم التصنيفات، والجداول التشغيلية التفصيلية.</p>
        </div>
        <div class="appendix-list">
          <span>تفاصيل المنافذ</span>
          <span>القواعد الحسابية</span>
          <span>جودة البيانات</span>
          <span>معجم التصنيفات</span>
          <span>الجداول التشغيلية</span>
          <span>التفاصيل الداعمة</span>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">التحليلات المتقدمة</div>
        <div class="table-wrap">
          <table>
            <tr><td>غلاف الجزء الثالث</td><td>13</td></tr>
            <tr><td>خريطة التحليلات المتقدمة</td><td>14</td></tr>
            <tr><td>أداء الموظفين</td><td>15–20</td></tr>
            <tr><td>تحليل الأخطاء والتوافق</td><td>21–22</td></tr>
            <tr><td>الأولوية والإجراءات</td><td>23</td></tr>
          </table>
        </div>
      </div>
    </div>
    <div class="page-no">02</div>
  </div>
</section>
```

**Placeholders:** None — static structure; page numbers are fixed.

---

## PAGE 3 — المعجم والمستويات (Glossary)

```html
<section class="page" id="page-glossary" data-title="المعجم والمستويات">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">المعجم</div>
    <div class="rail-tab">المستويات</div>
    <div class="rail-tab">المصطلحات</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">المعجم ودلالات المستويات</h2>
    <div class="section-subtitle">تعريف المستويات والمصطلحات الرئيسية</div>
    <div class="grid grid-4">
      <div class="card level-card stage1"><h3>المستوى الأول</h3><p>حالات تتضمن محجرات مخاطر ولم يتم الاشتباه بها من قبل المستوى الأول والثاني.</p></div>
      <div class="card level-card stage2"><h3>المستوى الثاني</h3><p>حالات لم يتم الاشتباه بها من قبل المستويين أو أحدهما، وتم الاشتباه بها من فريق أمني آخر.</p></div>
      <div class="card level-card stage3"><h3>المستوى الثالث</h3><p>حالات تم الاشتباه بها في الأشعة دون مؤشرات من الفرق الأمنية الأخرى.</p></div>
      <div class="card level-card stage4"><h3>المستوى الرابع</h3><p>حالات ضبط أمني أو اجتازت الأشعة دون اكتشاف الاشتباه من المسؤولين.</p></div>
    </div>
    <div class="grid grid-4" style="margin-top:18px">
      <div class="card"><h3 style="color:var(--green)">سليمة</h3><p class="muted">حالة لا توجد بها مؤشرات اشتباه بعد المراجعة.</p></div>
      <div class="card"><h3 style="color:var(--coral)">اشتباه</h3><p class="muted">مؤشر أو نمط يستلزم مراجعة إضافية.</p></div>
      <div class="card"><h3 style="color:var(--blue)">مجتمع الحالات</h3><p class="muted">جميع الحالات المشمولة بالتحليل.</p></div>
      <div class="card"><h3 style="color:var(--cyan)">العينة</h3><p class="muted">الجزء المختار للمراجعة والتحليل.</p></div>
      <div class="card"><h3 style="color:var(--purple)">التوزيع</h3><p class="muted">إسناد الحالات إلى الموظفين.</p></div>
      <div class="card"><h3 style="color:var(--cyan)">CertScan</h3><p class="muted">نظام أو مصدر داعم للمراجعة اللاحقة.</p></div>
      <div class="card"><h3 style="color:var(--gold)">مطابقة BI</h3><p class="muted">مطابقة بيانات الإرساليات بين الأنظمة.</p></div>
      <div class="card"><h3 style="color:var(--blue)">نتيجة المراجعة</h3><p class="muted">المرجع المستخدم لاحتساب مؤشرات الدقة.</p></div>
    </div>
    <div class="page-no">03</div>
  </div>
</section>
```

**Placeholders:** None — fully static glossary page.

---

## PAGE 4 — غلاف الجزء الأول (Part 1 Divider)

```html
<section class="page" id="page-part1" data-title="غلاف الجزء الأول">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الجزء الأول</div>
    <div class="rail-tab">الجزء الثاني</div>
    <div class="rail-tab">الجزء الثالث</div>
  </div>
  <div class="page-inner big-divider">
    <div>
      <div class="icon">◫</div>
      <div class="kicker">الجزء الأول</div>
      <h1>مجتمع الحالات</h1>
      <div class="rule"></div>
      <p class="lead">استعراض حجم المجتمع محل الدراسة وتوزيعه حسب المنفذ والمستوى ونمط الحركة تمهيدًا لتحليل النتائج والفجوات.</p>
    </div>
    <div class="page-no">04</div>
  </div>
</section>
```

**Placeholders:** None — static divider.

---

## PAGE 5 — مجتمع حالات المخاطر (Risk Population)

```html
<section class="page" id="page-pop-risk" data-title="مجتمع حالات المخاطر">
  <div class="right-rail">
    <div class="rail-main">الجزء الأول <em>مجتمع الحالات</em></div>
    <div class="rail-tab active">مجتمع المخاطر</div>
    <div class="rail-tab">المستويات</div>
    <div class="rail-tab">العينة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مجتمع حالات المخاطر</h2>
    <div class="section-subtitle">توزيع المجتمع بحسب نوع المنفذ والمنافذ التابعة له</div>
    <div class="grid grid-3">
      <div class="card"><h3>إجمالي المجتمع</h3><div class="metric gold">{{TOTAL_POPULATION}}</div></div>
      <div class="card"><h3>المنافذ البرية</h3><div class="metric green">{{LAND_TOTAL}}</div></div>
      <div class="card"><h3>المنافذ البحرية</h3><div class="metric blue">{{SEA_TOTAL}}</div></div>
    </div>
    <div class="info" style="margin:16px 0">منهجية التصنيف: تُعد الحالة اشتباه إذا كانت نتيجة المستوى الأول أو المستوى الثاني = اشتباه، وفي غير ذلك تُصنف سليمة.</div>
    <div class="port-split">
      <div class="card land">
        <div class="panel-title">المنافذ البرية</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
            <tbody>
              {{LAND_PORT_ROWS}}
              <tr class="total-row"><td>الإجمالي</td><td>{{LAND_TOTAL}}</td><td>{{LAND_CLEAN_TOTAL}}</td><td>{{LAND_SUSPECT_TOTAL}}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="card sea">
        <div class="panel-title">المنافذ البحرية</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
            <tbody>
              {{SEA_PORT_ROWS}}
              <tr class="total-row"><td>الإجمالي</td><td>{{SEA_TOTAL}}</td><td>{{SEA_CLEAN_TOTAL}}</td><td>{{SEA_SUSPECT_TOTAL}}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="page-no">05</div>
  </div>
</section>
```

**Placeholders:**
- `{{TOTAL_POPULATION}}` — total case count (number)
- `{{LAND_TOTAL}}` — land port total (number)
- `{{SEA_TOTAL}}` — sea port total (number)
- `{{LAND_PORT_ROWS}}` — `<tr>` rows for each land port (portName, total, clean, suspect)
- `{{LAND_CLEAN_TOTAL}}`, `{{LAND_SUSPECT_TOTAL}}` — sums
- `{{SEA_PORT_ROWS}}` — `<tr>` rows for each sea port
- `{{SEA_CLEAN_TOTAL}}`, `{{SEA_SUSPECT_TOTAL}}` — sums

Each row: `<tr><td>{{PORT_NAME}}</td><td>{{PORT_TOTAL}}</td><td>{{PORT_CLEAN}}</td><td>{{PORT_SUSPECT}}</td></tr>`

---

## PAGE 6 — المجتمع حسب المستويات (Population by Levels)

```html
<section class="page compact" id="page-pop-levels" data-title="المجتمع حسب المستويات">
  <div class="right-rail">
    <div class="rail-main">الجزء الأول <em>مجتمع الحالات</em></div>
    <div class="rail-tab active">المستويات</div>
    <div class="rail-tab">المنافذ</div>
    <div class="rail-tab">العينة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مجتمع الحالات حسب المستويات والمنافذ</h2>
    <div class="section-subtitle">توزيع الحالات داخل كل مستوى بحسب المنافذ ونتائج الأشعة الأصلية</div>
    <div class="grid grid-5">
      <div class="card"><h3>إجمالي المجتمع</h3><div class="metric gold">{{TOTAL_POPULATION}}</div></div>
      <div class="card stage1"><h3 style="color:var(--gold)">المستوى الأول</h3><div class="metric gold">{{LEVEL1_TOTAL}}</div></div>
      <div class="card stage2"><h3 style="color:var(--blue)">المستوى الثاني</h3><div class="metric blue">{{LEVEL2_TOTAL}}</div></div>
      <div class="card stage3"><h3 style="color:var(--slate)">المستوى الثالث</h3><div class="metric slate">{{LEVEL3_TOTAL}}</div></div>
      <div class="card stage4"><h3 style="color:var(--coral)">المستوى الرابع</h3><div class="metric coral">{{LEVEL4_TOTAL}}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:18px">
      <div class="card stage1">
        <div class="panel-title">المستوى الأول</div>
        <div class="table-wrap">
          <table>
            <tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr>
            {{LEVEL1_PORT_ROWS}}
          </table>
        </div>
      </div>
      <div class="card stage2">
        <div class="panel-title">المستوى الثاني</div>
        <div class="table-wrap">
          <table>
            <tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr>
            {{LEVEL2_PORT_ROWS}}
          </table>
        </div>
      </div>
      <div class="card stage3">
        <div class="panel-title">المستوى الثالث</div>
        <div class="table-wrap">
          <table>
            <tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr>
            {{LEVEL3_PORT_ROWS}}
          </table>
        </div>
      </div>
      <div class="card stage4">
        <div class="panel-title">المستوى الرابع</div>
        <div class="table-wrap">
          <table>
            <tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr>
            {{LEVEL4_PORT_ROWS}}
          </table>
        </div>
      </div>
    </div>
    <div class="page-no">06</div>
  </div>
</section>
```

**Placeholders:**
- `{{TOTAL_POPULATION}}`, `{{LEVEL1_TOTAL}}` … `{{LEVEL4_TOTAL}}` — counts per level
- `{{LEVEL1_PORT_ROWS}}` … `{{LEVEL4_PORT_ROWS}}` — `<tr>` rows per level

---

## PAGE 7 — العينة (Sample)

```html
<section class="page" id="page-sample" data-title="العينة">
  <div class="right-rail">
    <div class="rail-main">الجزء الأول <em>مجتمع الحالات</em></div>
    <div class="rail-tab">المجتمع</div>
    <div class="rail-tab active">العينة</div>
    <div class="rail-tab">التوزيع</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">العينة حسب المستويات والمنافذ</h2>
    <div class="section-subtitle">العينة المستهدفة ونسبة التغطية داخل كل مستوى</div>
    <div class="grid grid-4">
      <div class="card"><h3>إجمالي المجتمع</h3><div class="metric gold">{{TOTAL_POPULATION}}</div></div>
      <div class="card"><h3>إجمالي العينة</h3><div class="metric blue">{{TOTAL_SAMPLE}}</div></div>
      <div class="card"><h3>نسبة التغطية</h3><div class="metric green">{{COVERAGE_PCT}}</div></div>
      <div class="card"><h3>CertScan</h3><div class="metric cyan">{{CERTSCAN_COUNT}}</div></div>
    </div>
    <div class="info" style="margin:16px 0">{{SAMPLE_NOTE}}</div>
    <div class="grid grid-2">
      <div class="card stage1">
        <div class="panel-title">{{LEVEL1_SAMPLE_LABEL}}</div>
        <table>
          <tr><th>المنفذ</th><th>مجتمع المرحلة</th><th>العينة المستهدفة</th><th>التغطية</th></tr>
          {{LEVEL1_SAMPLE_ROWS}}
        </table>
      </div>
      <div class="card stage2">
        <div class="panel-title">{{LEVEL2_SAMPLE_LABEL}}</div>
        <table>
          <tr><th>المنفذ</th><th>مجتمع المرحلة</th><th>العينة المستهدفة</th><th>التغطية</th></tr>
          {{LEVEL2_SAMPLE_ROWS}}
        </table>
      </div>
      <div class="card stage3">
        <div class="panel-title">{{LEVEL3_SAMPLE_LABEL}}</div>
        <table>
          <tr><th>المنفذ</th><th>مجتمع المرحلة</th><th>العينة المستهدفة</th><th>التغطية</th></tr>
          {{LEVEL3_SAMPLE_ROWS}}
        </table>
      </div>
      <div class="card stage4">
        <div class="panel-title">{{LEVEL4_SAMPLE_LABEL}}</div>
        <table>
          <tr><th>المنفذ</th><th>مجتمع المرحلة</th><th>العينة المستهدفة</th><th>التغطية</th></tr>
          {{LEVEL4_SAMPLE_ROWS}}
        </table>
      </div>
    </div>
    <div class="page-no">07</div>
  </div>
</section>
```

**Placeholders:**
- `{{TOTAL_POPULATION}}`, `{{TOTAL_SAMPLE}}`, `{{COVERAGE_PCT}}`, `{{CERTSCAN_COUNT}}`
- `{{SAMPLE_NOTE}}` — informational text about the sample method
- `{{LEVEL1_SAMPLE_LABEL}}` … `{{LEVEL4_SAMPLE_LABEL}}` — e.g. "المستوى الأول — 143/143"
- `{{LEVEL1_SAMPLE_ROWS}}` … `{{LEVEL4_SAMPLE_ROWS}}` — `<tr>` rows per level

---

## PAGE 8 — غلاف الجزء الثاني (Part 2 Divider)

```html
<section class="page" id="page-part2" data-title="غلاف الجزء الثاني">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>نتائج الفحص</em></div>
    <div class="rail-tab">الجزء الأول</div>
    <div class="rail-tab active">الجزء الثاني</div>
    <div class="rail-tab">الجزء الثالث</div>
  </div>
  <div class="page-inner big-divider">
    <div>
      <div class="icon">⌕</div>
      <div class="kicker">الجزء الثاني</div>
      <h1>نتائج الفحص</h1>
      <div class="rule"></div>
      <p class="lead">تحليل نتائج المراجعة ونسب الدقة والفجوات على مستوى المنفذ والمستوى.</p>
    </div>
    <div class="page-no">08</div>
  </div>
</section>
```

**Placeholders:** None — static divider.

---

## PAGE 9 — نتائج الدقة حسب المنفذ (Accuracy by Port)

```html
<section class="page compact" id="page-acc-port" data-title="نتائج الدقة حسب المنفذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab active">دقة المنفذ</div>
    <div class="rail-tab">دقة المستوى</div>
    <div class="rail-tab">جودة الصور</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">نتائج الدقة حسب المنفذ</h2>
    <div class="section-subtitle">مقارنة دقة الفحص ودقة الاشتباه بين المنافذ</div>
    <div class="grid grid-4">
      <div class="card"><h3>دقة الفحص الكلية</h3><div class="metric green">{{OVERALL_INSPECTION_ACC}}</div></div>
      <div class="card"><h3>دقة الاشتباه الكلية</h3><div class="metric coral">{{OVERALL_SUSPECT_ACC}}</div></div>
      <div class="card"><h3>حالات الاشتباه المفحوصة</h3><div class="metric blue">{{TOTAL_SUSPECT_INSPECTED}}</div></div>
      <div class="card"><h3>الفجوة</h3><div class="metric gold">{{ACCURACY_GAP}}</div><span class="muted">نقطة</span></div>
    </div>
    <div class="info" style="margin:16px 0">نسبة دقة الفحص = تطابق نتيجة المراجع مع النتيجة الأصلية لجميع الحالات. نسبة دقة الاشتباه = التطابق ضمن حالات الاشتباه فقط.</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>المنفذ</th><th>الحالات المفحوصة</th><th>حالات الاشتباه</th><th>دقة الاشتباه</th><th>دقة الفحص</th><th>الفجوة</th></tr>
        </thead>
        <tbody>
          {{PORT_ACCURACY_ROWS}}
        </tbody>
      </table>
    </div>
    <div class="page-no">09</div>
  </div>
</section>
```

**Placeholders:**
- `{{OVERALL_INSPECTION_ACC}}`, `{{OVERALL_SUSPECT_ACC}}`, `{{TOTAL_SUSPECT_INSPECTED}}`, `{{ACCURACY_GAP}}`
- `{{PORT_ACCURACY_ROWS}}` — `<tr>` rows: portName, inspected, suspectCount, suspectAcc%, inspectionAcc%, gap

---

## PAGE 10 — نتائج الدقة حسب المستويات (Accuracy by Level)

```html
<section class="page compact" id="page-acc-level" data-title="نتائج الدقة حسب المستويات">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">دقة المنفذ</div>
    <div class="rail-tab active">دقة المستوى</div>
    <div class="rail-tab">جودة الصور</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">نتائج الدقة حسب المستويات</h2>
    <div class="section-subtitle">تحليل دقة الفحص ودقة الاشتباه عبر المستويات الأربعة</div>
    <div class="grid grid-4">
      <div class="card level-card stage1"><h3>المستوى الأول</h3><p>دقة الفحص</p><div class="metric gold">{{LEVEL1_INSP_ACC}}</div><p>دقة الاشتباه: {{LEVEL1_SUSP_ACC}}</p></div>
      <div class="card level-card stage2"><h3>المستوى الثاني</h3><p>دقة الفحص</p><div class="metric blue">{{LEVEL2_INSP_ACC}}</div><p>دقة الاشتباه: {{LEVEL2_SUSP_ACC}}</p></div>
      <div class="card level-card stage3"><h3>المستوى الثالث</h3><p>دقة الفحص</p><div class="metric slate">{{LEVEL3_INSP_ACC}}</div><p>دقة الاشتباه: {{LEVEL3_SUSP_ACC}}</p></div>
      <div class="card level-card stage4"><h3>المستوى الرابع</h3><p>دقة الفحص</p><div class="metric coral">{{LEVEL4_INSP_ACC}}</div><p>دقة الاشتباه: {{LEVEL4_SUSP_ACC}}</p></div>
    </div>
    <div class="table-wrap" style="margin-top:18px">
      <table>
        <tr><th>المستوى</th><th>الحالات المفحوصة</th><th>حالات الاشتباه</th><th>دقة الاشتباه</th><th>دقة الفحص</th><th>أبرز ملاحظة</th></tr>
        {{LEVEL_ACCURACY_ROWS}}
      </table>
    </div>
    <div class="info" style="margin-top:18px">الغرض: إبراز المستويات الأقوى وتحديد المستويات التي تتطلب تدخلًا، وفهم الفروق بين دقة الاشتباه ودقة الفحص الإجمالية.</div>
    <div class="page-no">10</div>
  </div>
</section>
```

**Placeholders:**
- `{{LEVEL1_INSP_ACC}}` … `{{LEVEL4_INSP_ACC}}` — inspection accuracy % per level
- `{{LEVEL1_SUSP_ACC}}` … `{{LEVEL4_SUSP_ACC}}` — suspect accuracy % per level
- `{{LEVEL_ACCURACY_ROWS}}` — `<tr>` rows for summary table

---

## PAGE 11 — نتائج جودة الصور (Image Quality)

```html
<section class="page compact" id="page-image-quality" data-title="نتائج جودة الصور">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">نتائج الدقة</div>
    <div class="rail-tab active">جودة الصور</div>
    <div class="rail-tab">الأصناف المشبوهة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">نتائج جودة الصور</h2>
    <div class="section-subtitle">تحليل جودة الصور ووجود التحديد وأثرهما على دقة الفحص</div>
    <div class="grid grid-4">
      <div class="card"><h3>الصور عالية الجودة</h3><div class="metric green">{{HIGH_QUALITY_PCT}}</div></div>
      <div class="card"><h3>وجود تحديد</h3><div class="metric blue">{{WITH_MARKING_PCT}}</div></div>
      <div class="card"><h3>الصور منخفضة الجودة</h3><div class="metric coral">{{LOW_QUALITY_PCT}}</div></div>
      <div class="card"><h3>الدقة دون تحديد</h3><div class="metric gold">{{ACC_WITHOUT_MARKING}}</div></div>
    </div>
    <div class="info" style="margin:16px 0">تتم مقارنة دقة الفحص بين الحالات التي بها تحديد والحالات التي لا يوجد بها تحديد لاختبار ما إذا كان غياب التحديد يرتبط بانخفاض الدقة.</div>
    <div class="table-wrap">
      <table>
        <tr><th>المنفذ</th><th>إجمالي الصور</th><th>جودة مرتفعة</th><th>وجود تحديد</th><th>دقة الفحص</th><th>ملاحظة</th></tr>
        {{IMAGE_QUALITY_PORT_ROWS}}
      </table>
    </div>
    <div class="grid grid-3" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أدنى 5 منافذ في جودة الصور</div>
        {{LOWEST_QUALITY_PORTS_BARS}}
      </div>
      <div class="card">
        <div class="panel-title">مقارنة الدقة حسب التحديد</div>
        <p>يوجد تحديد</p><div class="bar"><i style="width:{{WITH_MARKING_BAR_PCT}}%"></i></div>
        <p>لا يوجد تحديد</p><div class="bar"><i style="width:{{WITHOUT_MARKING_BAR_PCT}}%;background:var(--coral)"></i></div>
      </div>
      <div class="card">
        <div class="panel-title">أسباب انخفاض الجودة</div>
        {{LOW_QUALITY_REASONS}}
      </div>
    </div>
    <div class="page-no">11</div>
  </div>
</section>
```

**Placeholders:**
- `{{HIGH_QUALITY_PCT}}`, `{{WITH_MARKING_PCT}}`, `{{LOW_QUALITY_PCT}}`, `{{ACC_WITHOUT_MARKING}}`
- `{{IMAGE_QUALITY_PORT_ROWS}}` — `<tr>` rows per port
- `{{LOWEST_QUALITY_PORTS_BARS}}` — bar HTML for bottom-5 ports
- `{{WITH_MARKING_BAR_PCT}}`, `{{WITHOUT_MARKING_BAR_PCT}}` — 0–100 number
- `{{LOW_QUALITY_REASONS}}` — `<p>` elements for each reason

---

## PAGE 12 — الأصناف وآليات التهريب (Suspect Categories)

```html
<section class="page compact" id="page-categories" data-title="الأصناف وآليات التهريب">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">جودة الصور</div>
    <div class="rail-tab active">الأصناف المشبوهة</div>
    <div class="rail-tab">الجزء الثالث</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">الأصناف المشبوهة وآلية التهريب المحتملة</h2>
    <div class="section-subtitle">تحليل الأنماط النوعية المستخرجة من نتائج المراجعة</div>
    <div class="grid grid-4">
      <div class="card"><h3>حالات الاشتباه المؤكدة</h3><div class="metric gold">{{CONFIRMED_SUSPECT_COUNT}}</div></div>
      <div class="card"><h3>الأصناف المصنفة</h3><div class="metric blue">{{CATEGORY_COUNT}}</div></div>
      <div class="card"><h3>آليات التهريب المحتملة</h3><div class="metric coral">{{MECHANISM_COUNT}}</div></div>
      <div class="card"><h3>أعلى صنف تكرارًا</h3><div class="metric green" style="font-size:26px">{{TOP_CATEGORY_NAME}}</div></div>
    </div>
    <div class="info" style="margin:16px 0">تستخرج الأصناف وآليات التهريب من النصوص الحرة وتجمع في فئات معيارية قبل التحليل.</div>
    <div class="grid grid-2">
      <div class="card">
        <div class="panel-title">الأصناف الأكثر تكرارًا</div>
        {{CATEGORY_BARS}}
      </div>
      <div class="card">
        <div class="panel-title">آليات التهريب الأكثر تكرارًا</div>
        {{MECHANISM_BARS}}
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">ربط الأصناف بآليات التهريب</div>
        <div class="heatmap">
          <div class="hdr">الصنف / الآلية</div>
          {{HEATMAP_HEADERS}}
          {{HEATMAP_ROWS}}
        </div>
      </div>
      <div class="card">
        <div class="panel-title">أبرز الملاحظات</div>
        {{KEY_OBSERVATIONS}}
      </div>
    </div>
    <div class="page-no">12</div>
  </div>
</section>
```

**Placeholders:**
- `{{CONFIRMED_SUSPECT_COUNT}}`, `{{CATEGORY_COUNT}}`, `{{MECHANISM_COUNT}}`, `{{TOP_CATEGORY_NAME}}`
- `{{CATEGORY_BARS}}` — bar HTML for top categories
- `{{MECHANISM_BARS}}` — bar HTML for top mechanisms
- `{{HEATMAP_HEADERS}}` — `<div class="hdr">` elements for column headers
- `{{HEATMAP_ROWS}}` — heatmap cell rows using `.hm1`–`.hm5` classes
- `{{KEY_OBSERVATIONS}}` — `<p>` bullet observations

---

## PAGE 13 — غلاف التحاليل المتقدمة (Part 3 Divider)

```html
<section class="page cover" id="page-part3" data-title="غلاف التحاليل المتقدمة">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">الجزء الأول</div>
    <div class="rail-tab">الجزء الثاني</div>
    <div class="rail-tab active">الجزء الثالث</div>
    <div class="rail-tab">الملحق</div>
  </div>
  <div class="page-inner">
    <div class="org">
      <div class="shield"></div>
      <div class="org-lines">هيئة الزكاة والضريبة والجمارك<br>قطاع الشؤون القانونية<br>الإدارة العامة لضمان الجودة والامتثال<br>إدارة ضمان جودة الأشعة اللاحقة</div>
    </div>
    <div class="title-block">
      <div class="kicker">الجزء الثالث</div>
      <h1>التحاليل المتقدمة</h1>
      <div class="subtitle">تحليل أداء الموظفين واختلاف المنافذ والعوامل المؤثرة على الدقة ومؤشرات المخاطر</div>
      <div class="rule"></div>
      <p class="lead">تحليلات متقدمة للكشف عن الأنماط الخفية في الأداء، وتحديد الفجوات التشغيلية وفرص التحسين، ودعم متخذي القرار بمؤشرات قابلة للتنفيذ.</p>
      <div class="feature-grid">
        <div class="feature">أداء الموظفين</div>
        <div class="feature">مقارنة المنافذ</div>
        <div class="feature">تحليل الأخطاء</div>
        <div class="feature">الاستقرار والتذبذب</div>
        <div class="feature">أثر جودة الصورة</div>
        <div class="feature">مؤشر الأداء المركب</div>
      </div>
    </div>
    <div class="page-no">13</div>
  </div>
</section>
```

**Placeholders:** None — static cover page.

---

## PAGE 14 — خريطة التحليلات المتقدمة (Analytics Map)

```html
<section class="page" id="page-analytics-map" data-title="خريطة التحليلات المتقدمة">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">الخريطة</div>
    <div class="rail-tab">الموظفون</div>
    <div class="rail-tab">العوامل</div>
    <div class="rail-tab">القرارات</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">خريطة التحليلات المتقدمة</h2>
    <div class="section-subtitle">الصفحات الموصى بها ضمن الجزء الثالث</div>
    <div class="grid grid-2">
      <div class="card">
        <div class="panel-title">أداء الموظفين</div>
        <p>14 — النظرة العامة لأداء الموظفين</p>
        <p>15 — دقة الموظفين حسب نوع القرار</p>
        <p>16–26 — أداء الموظفين حسب المنفذ</p>
        <p>27 — مقارنة الموظفين بين المنافذ</p>
      </div>
      <div class="card">
        <div class="panel-title">تحليل العوامل المؤثرة</div>
        <p>28 — استقرار الأداء والتذبذب</p>
        <p>29 — عبء العمل وعلاقته بالدقة</p>
        <p>30 — أثر جودة الصورة على الأداء</p>
        <p>31 — أثر وجود التحديد</p>
      </div>
      <div class="card">
        <div class="panel-title">تحليل الأخطاء والأنماط</div>
        <p>32 — تحليل أنواع الأخطاء</p>
        <p>33 — الموظف والأصناف المشبوهة</p>
        <p>34 — الموظف وآلية التهريب</p>
        <p>35 — الأداء حسب نوع الحركة</p>
      </div>
      <div class="card">
        <div class="panel-title">القرارات والتوصيات</div>
        <p>36 — مقارنة المستوى الأول والثاني</p>
        <p>37 — توافق أزواج الموظفين</p>
        <p>38 — مؤشر الأداء المركب</p>
        <p>39 — الموظفون ذوو الأولوية</p>
      </div>
    </div>
    <div class="info" style="margin-top:18px">يمكن إبقاء الصفحات ذات الأولوية في النسخة التنفيذية، ونقل الصفحات التفصيلية والمتكررة إلى الملاحق.</div>
    <div class="page-no">14</div>
  </div>
</section>
```

**Placeholders:** None — static analytics roadmap page.

---

## PAGE 15 — النظرة العامة لأداء الموظفين (Employee Performance Overview)

```html
<section class="page compact" id="page-emp-overview" data-title="النظرة العامة لأداء الموظفين">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">أداء الموظفين</div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab">الاستقرار</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">النظرة العامة لأداء الموظفين</h2>
    <div class="section-subtitle">مقارنة الأداء العام للموظفين بغض النظر عن المستوى</div>
    <div class="grid grid-5">
      <div class="card"><h3>الموظفون المقيمون</h3><div class="metric blue">{{EMPLOYEE_COUNT}}</div></div>
      <div class="card"><h3>إجمالي القرارات</h3><div class="metric gold">{{TOTAL_DECISIONS}}</div></div>
      <div class="card"><h3>متوسط الدقة</h3><div class="metric green">{{AVG_ACCURACY}}</div></div>
      <div class="card"><h3>أفضل دقة</h3><div class="metric green">{{BEST_ACCURACY}}</div></div>
      <div class="card"><h3>أعلى تفاوت</h3><div class="metric coral">{{MAX_VARIANCE}}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <tr><th>الموظف</th><th>القرارات</th><th>المستوى الأول</th><th>المستوى الثاني</th><th>دقة الفحص</th><th>دقة الاشتباه</th><th>معدل الاكتشاف</th><th>المنافذ</th><th>التصنيف</th></tr>
        {{EMPLOYEE_ROWS}}
      </table>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أفضل 5 موظفين</div>
        {{TOP5_BARS}}
      </div>
      <div class="card">
        <div class="panel-title">منهجية القياس</div>
        <p><b style="color:var(--green)">دقة الفحص:</b> تطابق قرار الموظف مع نتيجة المراجع لجميع الحالات.</p>
        <p><b style="color:var(--coral)">دقة الاشتباه:</b> التطابق ضمن حالات الاشتباه فقط.</p>
        <p class="muted">التقييم مبني على القرار وجودته وليس على المستوى الوظيفي وحده.</p>
      </div>
    </div>
    <div class="page-no">15</div>
  </div>
</section>
```

**Placeholders:**
- `{{EMPLOYEE_COUNT}}`, `{{TOTAL_DECISIONS}}`, `{{AVG_ACCURACY}}`, `{{BEST_ACCURACY}}`, `{{MAX_VARIANCE}}`
- `{{EMPLOYEE_ROWS}}` — one `<tr>` per employee: name, decisions, level1Acc, level2Acc, inspAcc, suspAcc, detectionRate, portCount, badge chip
- `{{TOP5_BARS}}` — `<p>name</p><div class="bar"><i style="width:XX%"></i></div>` for top 5

Badge chip format: `<span class="chip green">متميز</span>` / `<span class="chip blue">مستقر</span>` / `<span class="chip orange">يحتاج متابعة</span>` / `<span class="chip red">بيانات غير كافية</span>`

---

## PAGE 16 — دقة الموظفين حسب القرار (Accuracy by Decision Type)

```html
<section class="page compact" id="page-emp-decision" data-title="دقة الموظفين حسب القرار">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab active">نوع القرار</div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab">تحليل الأخطاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">دقة الموظفين حسب نوع القرار</h2>
    <div class="section-subtitle">الفصل بين الدقة الكلية واكتشاف الاشتباه والإنذارات الخاطئة</div>
    <div class="grid grid-4">
      <div class="card"><h3>الدقة الكلية</h3><div class="metric green">{{OVERALL_ACC}}</div></div>
      <div class="card"><h3>اكتشاف الاشتباه</h3><div class="metric blue">{{DETECTION_RATE}}</div></div>
      <div class="card"><h3>الاشتباه الفائت</h3><div class="metric purple">{{MISSED_SUSPECT_RATE}}</div></div>
      <div class="card"><h3>الاشتباه الخاطئ</h3><div class="metric coral">{{FALSE_SUSPECT_RATE}}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">تصنيف الموظفين حسب نوع الأداء</div>
        <div class="quad">
          <div><h4 style="color:var(--green)">دقة عالية / اكتشاف مرتفع</h4><p>أفضل نمط أداء</p></div>
          <div><h4 style="color:var(--gold)">دقة منخفضة / اكتشاف مرتفع</h4><p>مراجعة الدقة العامة</p></div>
          <div><h4 style="color:var(--blue)">دقة عالية / اكتشاف منخفض</h4><p>خطر خفي رغم الدقة الكلية</p></div>
          <div><h4 style="color:var(--coral)">دقة منخفضة / اكتشاف منخفض</h4><p>أولوية تدخل مرتفعة</p></div>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">ملخص الأداء حسب القرار</div>
        <div class="table-wrap">
          <table>
            <tr><th>الموظف</th><th>السليمة</th><th>دقة السليمة</th><th>الاشتباه</th><th>الاكتشاف</th><th>الخاطئ</th></tr>
            {{DECISION_TYPE_ROWS}}
          </table>
        </div>
      </div>
    </div>
    <div class="info" style="margin-top:16px">قد تخفي الدقة الكلية المرتفعة ضعفًا في اكتشاف حالات الاشتباه؛ لذلك يعرض التقرير المؤشرين بصورة منفصلة.</div>
    <div class="page-no">16</div>
  </div>
</section>
```

**Placeholders:**
- `{{OVERALL_ACC}}`, `{{DETECTION_RATE}}`, `{{MISSED_SUSPECT_RATE}}`, `{{FALSE_SUSPECT_RATE}}`
- `{{DECISION_TYPE_ROWS}}` — one `<tr>` per employee: name, cleanCount, cleanAcc%, suspectCount, detectionRate%, falseAlarmRate%

---

## PAGE 17 — أداء الموظفين حسب المنفذ (Employee Performance by Port)

```html
<section class="page compact" id="page-emp-port" data-title="أداء الموظفين حسب المنفذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">أداء الموظفين</div>
    <div class="rail-tab active">حسب المنفذ</div>
    <div class="rail-tab">المقارنة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أداء الموظفين حسب المنفذ</h2>
    <div class="section-subtitle">مثال تطبيقي — منفذ {{EXAMPLE_PORT_NAME}}</div>
    <div class="grid grid-5">
      <div class="card"><h3>الحالات المفحوصة</h3><div class="metric gold">{{PORT_CASES}}</div></div>
      <div class="card"><h3>عدد الموظفين</h3><div class="metric blue">{{PORT_EMP_COUNT}}</div></div>
      <div class="card"><h3>دقة الفحص</h3><div class="metric blue">{{PORT_INSP_ACC}}</div></div>
      <div class="card"><h3>دقة الاشتباه</h3><div class="metric green">{{PORT_SUSP_ACC}}</div></div>
      <div class="card"><h3>الاشتباه الفائت</h3><div class="metric coral">{{PORT_MISSED_SUSPECT}}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <tr><th>الموظف</th><th>القرارات</th><th>المستوى الأول</th><th>المستوى الثاني</th><th>دقة الفحص</th><th>دقة الاشتباه</th><th>مقارنة بالمتوسط</th><th>التصنيف</th></tr>
        {{PORT_EMP_ROWS}}
      </table>
    </div>
    <div class="grid grid-3" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أفضل 3 موظفين</div>
        {{TOP3_PORT_EMPS}}
      </div>
      <div class="card">
        <div class="panel-title">أقل 3 موظفين</div>
        {{BOTTOM3_PORT_EMPS}}
      </div>
      <div class="card">
        <div class="panel-title">ملاحظات المنفذ</div>
        {{PORT_NOTES}}
      </div>
    </div>
    <div class="page-no">17</div>
  </div>
</section>
```

**Placeholders:**
- `{{EXAMPLE_PORT_NAME}}` — port name shown in subtitle
- `{{PORT_CASES}}`, `{{PORT_EMP_COUNT}}`, `{{PORT_INSP_ACC}}`, `{{PORT_SUSP_ACC}}`, `{{PORT_MISSED_SUSPECT}}`
- `{{PORT_EMP_ROWS}}` — one `<tr>` per employee at this port
- `{{TOP3_PORT_EMPS}}`, `{{BOTTOM3_PORT_EMPS}}` — `<p>` rank list
- `{{PORT_NOTES}}` — `<p>` observation paragraphs

---

## PAGE 18 — مقارنة الموظفين بين المنافذ (Cross-Port Comparison)

```html
<section class="page compact" id="page-emp-cross-port" data-title="مقارنة الموظفين بين المنافذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab active">المقارنة</div>
    <div class="rail-tab">الاستقرار</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مقارنة الموظفين بين المنافذ</h2>
    <div class="section-subtitle">مصفوفة أداء الموظفين حسب المنفذ</div>
    <div class="grid grid-4">
      <div class="card"><h3>المنافذ المقارنة</h3><div class="metric blue">{{PORT_COUNT}}</div></div>
      <div class="card"><h3>أفضل منفذ</h3><div class="metric blue" style="font-size:24px">{{BEST_PORT_NAME}}</div></div>
      <div class="card"><h3>أكبر فرق أداء</h3><div class="metric coral">{{MAX_PORT_DIFF}}</div></div>
      <div class="card"><h3>أكثر الموظفين استقرارًا</h3><div class="metric green" style="font-size:24px">{{MOST_STABLE_EMP}}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <tr>
          <th>الموظف</th>
          {{CROSS_PORT_HEADERS}}
        </tr>
        {{CROSS_PORT_ROWS}}
      </table>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أفضل منفذ لكل موظف</div>
        {{BEST_PORT_PER_EMP}}
      </div>
      <div class="card">
        <div class="panel-title">أضعف منفذ لكل موظف</div>
        {{WORST_PORT_PER_EMP}}
      </div>
    </div>
    <div class="page-no">18</div>
  </div>
</section>
```

**Placeholders:**
- `{{PORT_COUNT}}`, `{{BEST_PORT_NAME}}`, `{{MAX_PORT_DIFF}}`, `{{MOST_STABLE_EMP}}`
- `{{CROSS_PORT_HEADERS}}` — `<th>portName</th>` for each port column
- `{{CROSS_PORT_ROWS}}` — one `<tr>` per employee with cells using `.hm1`–`.hm5` heatmap classes
- `{{BEST_PORT_PER_EMP}}`, `{{WORST_PORT_PER_EMP}}` — `<p>empName — portName</p>` list

Heatmap cell format: `<td class="hm3">XX%</td>` where hm1=lowest, hm5=highest performance.

---

## PAGE 19 — استقرار الأداء وعبء العمل (Performance Stability)

```html
<section class="page compact" id="page-stability" data-title="استقرار الأداء وعبء العمل">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">المقارنة</div>
    <div class="rail-tab active">الاستقرار والحمل</div>
    <div class="rail-tab">أثر الجودة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">استقرار الأداء وعبء العمل</h2>
    <div class="section-subtitle">قياس تذبذب الدقة وعلاقته بعدد القرارات</div>
    <div class="grid grid-4">
      <div class="card"><h3>متوسط الدقة</h3><div class="metric green">{{AVG_ACCURACY}}</div></div>
      <div class="card"><h3>تذبذب الأداء</h3><div class="metric coral">{{PERFORMANCE_VARIANCE}}</div></div>
      <div class="card"><h3>أعلى حمل يومي</h3><div class="metric blue">{{MAX_DAILY_LOAD}}</div></div>
      <div class="card"><h3>فرق الدقة</h3><div class="metric green">{{ACCURACY_DIFF}}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">استقرار أداء الموظفين</div>
        <table>
          <tr><th>الموظف</th><th>متوسط الدقة</th><th>التذبذب</th><th>الاتجاه</th></tr>
          {{STABILITY_ROWS}}
        </table>
      </div>
      <div class="card">
        <div class="panel-title">عبء العمل مقابل الدقة</div>
        <div class="chart-container bubble-chart">
          {{WORKLOAD_BUBBLE_CHART}}
        </div>
        <div class="small-note">المحور الأفقي: عدد القرارات — المحور الرأسي: دقة الفحص</div>
      </div>
    </div>
    <div class="info" style="margin-top:16px">قد يحافظ بعض الموظفين على دقة مرتفعة رغم ارتفاع عبء العمل، بينما يتأثر آخرون سلبًا مع زيادة عدد القرارات.</div>
    <div class="page-no">19</div>
  </div>
</section>
```

**Placeholders:**
- `{{AVG_ACCURACY}}`, `{{PERFORMANCE_VARIANCE}}`, `{{MAX_DAILY_LOAD}}`, `{{ACCURACY_DIFF}}`
- `{{STABILITY_ROWS}}` — one `<tr>` per employee: name, avgAcc%, variance%, trend arrow (↗/→/↘)
- `{{WORKLOAD_BUBBLE_CHART}}` — inline SVG or positioned bubble spans (see mockup for reference)

---

## PAGE 20 — أثر جودة الصورة والتحديد (Image Quality Impact)

```html
<section class="page compact" id="page-quality-impact" data-title="أثر جودة الصورة والتحديد">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">الاستقرار</div>
    <div class="rail-tab active">جودة الصورة والتحديد</div>
    <div class="rail-tab">الأخطاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أثر جودة الصورة والتحديد على الأداء</h2>
    <div class="section-subtitle">تحليل ما إذا كانت جودة الصورة ووجود التحديد يرتبطان بانخفاض أو ارتفاع الدقة</div>
    <div class="grid grid-4">
      <div class="card"><h3>جودة عالية</h3><div class="metric blue">{{HIGH_QUALITY_ACC}}</div></div>
      <div class="card"><h3>جودة منخفضة</h3><div class="metric coral">{{LOW_QUALITY_ACC}}</div></div>
      <div class="card"><h3>مع تحديد</h3><div class="metric gold">{{WITH_MARKING_ACC}}</div></div>
      <div class="card"><h3>دون تحديد</h3><div class="metric green">{{WITHOUT_MARKING_ACC}}</div></div>
    </div>
    <div class="quad" style="margin-top:16px">
      <div><h4 style="color:var(--gold)">عالية الجودة + يوجد تحديد</h4><div class="metric gold">{{HQ_WM_ACC}}</div><p>أفضل سيناريو متوقع.</p></div>
      <div><h4 style="color:var(--blue)">عالية الجودة + لا يوجد تحديد</h4><div class="metric blue">{{HQ_NM_ACC}}</div><p>جودة جيدة مع فقدان معلومات مساعدة.</p></div>
      <div><h4 style="color:var(--gold)">منخفضة/متوسطة + يوجد تحديد</h4><div class="metric gold">{{LQ_WM_ACC}}</div><p>التحديد قد يخفف أثر انخفاض الجودة.</p></div>
      <div><h4 style="color:var(--coral)">منخفضة/متوسطة + لا يوجد تحديد</h4><div class="metric coral">{{LQ_NM_ACC}}</div><p>أعلى خطر لانخفاض الدقة.</p></div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <tr><th>الموظف</th><th>جودة عالية</th><th>جودة منخفضة</th><th>مع تحديد</th><th>دون تحديد</th><th>فرق الأثر</th></tr>
        {{QUALITY_IMPACT_ROWS}}
      </table>
    </div>
    <div class="page-no">20</div>
  </div>
</section>
```

**Placeholders:**
- `{{HIGH_QUALITY_ACC}}`, `{{LOW_QUALITY_ACC}}`, `{{WITH_MARKING_ACC}}`, `{{WITHOUT_MARKING_ACC}}`
- `{{HQ_WM_ACC}}`, `{{HQ_NM_ACC}}`, `{{LQ_WM_ACC}}`, `{{LQ_NM_ACC}}` — quad cell values
- `{{QUALITY_IMPACT_ROWS}}` — one `<tr>` per employee with quality/marking accuracy breakdown

---

## PAGE 21 — تحليل أنواع الأخطاء (Error Type Analysis)

```html
<section class="page compact" id="page-error-types" data-title="تحليل أنواع الأخطاء">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">جودة الصورة</div>
    <div class="rail-tab active">تحليل الأخطاء</div>
    <div class="rail-tab">التوافق</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">تحليل أنواع الأخطاء</h2>
    <div class="section-subtitle">تصنيف القرارات بين اشتباه صحيح واشتباه فائت واشتباه خاطئ وسليمة صحيحة</div>
    <div class="grid grid-4">
      <div class="card"><h3>اشتباه صحيح</h3><div class="metric gold">{{TRUE_SUSPECT_PCT}}</div></div>
      <div class="card"><h3>اشتباه فائت</h3><div class="metric blue">{{MISSED_SUSPECT_PCT}}</div></div>
      <div class="card"><h3>اشتباه خاطئ</h3><div class="metric coral">{{FALSE_SUSPECT_PCT}}</div></div>
      <div class="card"><h3>سليمة صحيحة</h3><div class="metric green">{{TRUE_CLEAN_PCT}}</div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">مصفوفة تصنيف القرارات</div>
        <div class="quad">
          <div style="background:rgba(255,118,95,.08)"><h4 style="color:var(--coral)">اشتباه خاطئ</h4><p>إنذار كاذب</p></div>
          <div style="background:rgba(244,180,0,.08)"><h4 style="color:var(--gold)">اشتباه صحيح</h4><p>كشف صحيح</p></div>
          <div style="background:rgba(139,195,74,.08)"><h4 style="color:var(--green)">سليمة صحيحة</h4><p>قبول صحيح</p></div>
          <div style="background:rgba(107,169,248,.08)"><h4 style="color:var(--blue)">اشتباه فائت</h4><p>حالة لم تُكتشف</p></div>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">تعريف الأنواع</div>
        <p><b style="color:var(--gold)">الاشتباه الصحيح:</b> قرار أدى إلى كشف حالة مشتبه بها.</p>
        <p><b style="color:var(--blue)">الاشتباه الفائت:</b> حالة مشتبه بها صنفت سليمة.</p>
        <p><b style="color:var(--coral)">الاشتباه الخاطئ:</b> حالة سليمة صنفت اشتباه.</p>
        <p><b style="color:var(--green)">السليمة الصحيحة:</b> حالة سليمة صنفت سليمة.</p>
      </div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <tr><th>الموظف</th><th>اشتباه صحيح</th><th>اشتباه فائت</th><th>اشتباه خاطئ</th><th>سليمة صحيحة</th><th>أبرز نمط خطأ</th></tr>
        {{ERROR_TYPE_ROWS}}
      </table>
    </div>
    <div class="info" style="margin-top:16px"><b style="color:var(--gold)">الاشتباه الفائت هو نوع الخطأ الأعلى خطورة</b> لأنه يمثل حالة مشتبه بها لم يتم اكتشافها.</div>
    <div class="page-no">21</div>
  </div>
</section>
```

**Placeholders:**
- `{{TRUE_SUSPECT_PCT}}`, `{{MISSED_SUSPECT_PCT}}`, `{{FALSE_SUSPECT_PCT}}`, `{{TRUE_CLEAN_PCT}}`
- `{{ERROR_TYPE_ROWS}}` — one `<tr>` per employee: name, trueSuspect%, missed%, false%, trueClean%, topErrorPattern

---

## PAGE 22 — مقارنة المستويين والتوافق (Level Comparison & Agreement)

```html
<section class="page compact" id="page-level-agreement" data-title="مقارنة المستويين والتوافق">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">الأخطاء</div>
    <div class="rail-tab active">المستويان والتوافق</div>
    <div class="rail-tab">الإجراءات</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مقارنة المستوى الأول والثاني وتوافق الموظفين</h2>
    <div class="section-subtitle">قياس الفروق بين المستويين ونسبة الاتفاق بين أزواج الموظفين</div>
    <div class="grid grid-4">
      <div class="card"><h3>دقة المستوى الأول</h3><div class="metric gold">{{LEVEL1_ACC}}</div></div>
      <div class="card"><h3>دقة المستوى الثاني</h3><div class="metric blue">{{LEVEL2_ACC}}</div></div>
      <div class="card"><h3>نسبة الاتفاق</h3><div class="metric blue">{{AGREEMENT_RATE}}</div></div>
      <div class="card"><h3>الحالات المعدلة</h3><div class="metric coral">{{REVISED_COUNT}}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <tr><th>المؤشر</th><th>المستوى الأول</th><th>المستوى الثاني</th><th>الفارق</th></tr>
        {{LEVEL_COMPARISON_ROWS}}
      </table>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="panel-title">توافق أزواج الموظفين</div>
      <div class="table-wrap">
        <table>
          <tr>
            <th>المستوى الأول \ الثاني</th>
            {{PAIR_MATRIX_HEADERS}}
          </tr>
          {{PAIR_MATRIX_ROWS}}
        </table>
      </div>
    </div>
    <div class="info" style="margin-top:16px">ارتفاع نسبة الاتفاق بين الموظفين لا يعني بالضرورة صحة النتائج؛ يجب دائمًا ربط التوافق بدقة الفحص وجودة القرار.</div>
    <div class="page-no">22</div>
  </div>
</section>
```

**Placeholders:**
- `{{LEVEL1_ACC}}`, `{{LEVEL2_ACC}}`, `{{AGREEMENT_RATE}}`, `{{REVISED_COUNT}}`
- `{{LEVEL_COMPARISON_ROWS}}` — rows: inspectionAcc, suspectAcc, revisedCount, correctRevisions
- `{{PAIR_MATRIX_HEADERS}}` — `<th>empName</th>` for each employee column
- `{{PAIR_MATRIX_ROWS}}` — cross-employee agreement percentage matrix rows

---

## PAGE 23 — الأولوية والإجراءات (Priority & Actions)

```html
<section class="page compact" id="page-priority" data-title="الأولوية والإجراءات">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">التوافق</div>
    <div class="rail-tab active">الأولوية والإجراءات</div>
    <div class="rail-tab">الملحق</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">الموظفون ذوو الأولوية والإجراءات المقترحة</h2>
    <div class="section-subtitle">تجميع الموظفين بحسب الأولوية الإشرافية والتدخل المطلوب</div>
    <div class="grid grid-4">
      <div class="card"><h3>دعم عاجل</h3><div class="metric coral">{{URGENT_COUNT}}</div></div>
      <div class="card"><h3>تدريب موجه</h3><div class="metric blue">{{TRAINING_COUNT}}</div></div>
      <div class="card"><h3>متابعة</h3><div class="metric gold">{{MONITOR_COUNT}}</div></div>
      <div class="card"><h3>متميز</h3><div class="metric green">{{EXCELLENT_COUNT}}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <tr><th>الموظف</th><th>الملاحظة الرئيسية</th><th>الدليل</th><th>الإجراء المقترح</th><th>الأولوية</th></tr>
        {{PRIORITY_ROWS}}
      </table>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">مصفوفة أولوية التدخل</div>
        <div class="quad">
          <div><h4>أثر عالٍ / أولوية منخفضة</h4><p>تحسينات اختيارية</p></div>
          <div><h4 style="color:var(--coral)">أثر عالٍ / أولوية عالية</h4><p>تدخل فوري ودعم مباشر</p></div>
          <div><h4 style="color:var(--green)">أثر منخفض / أولوية منخفضة</h4><p>متابعة دورية</p></div>
          <div><h4 style="color:var(--gold)">أثر منخفض / أولوية عالية</h4><p>تحسينات وسطية</p></div>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">أهم التوصيات التنفيذية</div>
        <p>• التدريب الموجه</p>
        <p>• المراجعة الثنائية</p>
        <p>• تحسين التحديد</p>
        <p>• متابعة الأداء</p>
        <p>• إعادة توزيع الحالات</p>
      </div>
    </div>
    <div class="info" style="margin-top:16px">يرجى اعتماد خطط التدخل المقترحة للشروع في التنفيذ والمتابعة خلال الفترة القادمة.</div>
    <div class="page-no">23</div>
  </div>
</section>
```

**Placeholders:**
- `{{URGENT_COUNT}}`, `{{TRAINING_COUNT}}`, `{{MONITOR_COUNT}}`, `{{EXCELLENT_COUNT}}`
- `{{PRIORITY_ROWS}}` — one `<tr>` per employee: name, mainObservation, evidence, proposedAction, priority chip

Priority chip format:
- `<span class="chip red">حرج</span>` — urgent/critical
- `<span class="chip orange">مرتفع</span>` — high
- `<span class="chip orange">متوسط</span>` — medium
- `<span class="chip green">منخفض</span>` — low

---

## Data-to-placeholder mapping summary

| Placeholder category | Source in `ExecutiveRenderContext` |
|---|---|
| Population totals (`TOTAL_POPULATION`, level totals) | `ctx.population` |
| Port breakdowns (land/sea rows) | `ctx.population.portBreakdown` |
| Sample metrics | `ctx.sample` |
| Accuracy metrics | `ctx.results.accuracy` |
| Image quality | `ctx.results.imageQuality` |
| Suspect categories | `ctx.results.categories` |
| Employee data | `ctx.employees[]` |
| Month/cycle labels | `ctx.monthLabel`, `ctx.reportCycleLabel` |

See `src/data/reporting/executive/context.ts` for the full `ExecutiveRenderContext` type definition.
