# منصة ضمان جودة الأشعة السينية (XQAP)

> أداة بدون خادم خلفي لسحب عيّنة إحصائية من صور الأشعة السينية، توزيعها على فريق الفحص، وإصدار تقارير ضمان الجودة — بالعربية أولًا ومن اليمين إلى اليسار.
>
> A backend-free tool for drawing a statistical sample of X-ray images, distributing them to an inspection team, and producing quality-assurance reports — Arabic-first, right-to-left.

[العربية](#العربية) · [English](#english)

---

<div dir="rtl" align="right">

## العربية

### نظرة عامة

XQAP تطبيق ويب من صفحة واحدة (SPA)، مبني بالكامل من جهة العميل بدون أي خادم خلفي، موجّه لفرق ضمان الجودة التي تراجع صور الأشعة السينية — من النوع المستخدم في فحص الأمتعة أو الشحنات عبر الموانئ. الواجهة عربية بالكامل واتجاهها من اليمين إلى اليسار (RTL) افتراضيًا، وكل بيانات العمل تُخزَّن كملفات JSON عادية داخل مجلد "مساحة عمل" يختاره المستخدم على جهازه — لا قواعد بيانات، ولا خوادم، ولا حسابات سحابية.

### الهدف

تمكين فريق ضمان الجودة من:

- سحب عيّنة عشوائية ذات دلالة إحصائية من الصور التي سبق أن راجعها فاحصو الأشعة.
- تكليف مفتّشين مستقلّين بإعادة فحصها وفق نموذج فحص موحّد وقابل للتخصيص.
- تتبّع كل عملية إسناد أو استبدال أو إعادة تعيين كحدث مسجَّل، لا كتعديل يمحو ما قبله.
- إنتاج تقارير تُثبت أن عملية المراجعة نفسها سليمة وقابلة للتدقيق.

كل ذلك دون الحاجة إلى فريق تقني يُشغّل خوادم أو قواعد بيانات — مجلد على القرص يكفي.

### الفكرة الأساسية

- **المسار الأساسي:** استيراد إكسل ← معالجة العروضية ← سحب العينة ← التوزيع ← جمع الإجابات ← التقارير.
- **لا خادم خلفي:** مجلد مساحة العمل الذي يختاره المستخدم هو المصدر الوحيد للحقيقة؛ كل شيء ملفات JSON قابلة للنقل، محمية بطبقة "كتابة آمنة" (نسخ مؤقتة ← تحقق ← اعتماد، مع نسخة احتياطية `.bak`).
- **أخذ عيّنة حتمي وقابل للتدقيق:** مولّد أرقام عشوائي بذرة ثابتة (Mulberry32) مع تناسب هاملتون، ورقم إصدار للخوارزمية بحيث لا تُعاد "محاكاة" عيّنة قديمة بمنطق مختلف دون علم أحد.
- **سجل توزيع بالإضافة فقط:** كل تعيين أو استبدال أو إعادة تعيين حدث منفصل لا يُكتب فوق سابقه، فيمكن إعادة بناء تاريخ "من فعل ماذا" بالكامل في أي وقت.
- **فحص مبني على قوالب:** الأسئلة التي يجيب عنها المفتشون يحدّدها مسؤول عبر قالب قابل للتعديل، وليست مكتوبة داخل الكود.
- **العربية أولًا، لا إضافة لاحقة:** كل نص في الواجهة عربي افتراضيًا (وقابل للتخصيص عبر مفاتيح تسميات)، لأن المستخدمين المستهدَفين فرق عربية.
- **نموذج أمان استشاري صراحةً:** الأدوار والصلاحيات وسيلة لتوجيه الواجهة، وليست حدّ ثقة صارمًا — موثَّق بوضوح حتى لا يُفهم خطأً كضبط وصول على مستوى المؤسسات.

### الوحدات

| الوحدة | ماذا تفعل |
|---|---|
| **العروضية** (Population) | استيراد ملفات إكسل (بيانات المخاطر إلزامية، بيانات BI اختيارية) عبر عامل ويب لا يجمّد الواجهة، تجهيز ومطابقة الأعمدة والتحقق من البيانات، حفظ لقطة الشهر، ثم سحب عيّنة عشوائية طبقية (تناسب هاملتون + خلط فيشر-ييتس) مقسّمة حسب الميناء ونوع الفحص (CertScan/NonCertScan)، وأخيرًا توزيع صفوف العيّنة على فريق الفحص. تتضمّن أيضًا تقرير "دقة البيانات" الذي يفحص تكامل الروابط بين العروضية والعيّنة والتوزيع والإجابات. |
| **مساحة عمل الموظف** (Employee Workspace) | الشاشة اليومية للمفتّش: قائمة الصور المُحالة إليه، تقديم نتائج الفحص، طلب/اعتماد استبدال الإحالات، ونموذج الفحص نفسه المبني من القالب النشط. |
| **مركز الإشعارات** (Notification Center) | إشعارات عامة على مستوى مساحة العمل يرسلها المدراء، ويجب على المستلمين الإقرار باستلامها — محمية من التعارض عند تعدّد المستخدمين على نفس المجلد المشترك. |
| **التقارير** (Reports) | تقارير HTML جاهزة (عيّنة، توزيع، تنفيذي) قابلة للطباعة وقائمة بذاتها؛ لوحات مؤشرات أداء (KPI) للمشرفين والمدراء؛ ومصمّم تقارير (Report Designer) بواجهة سحب وإفلات لبناء تقارير مخصّصة (أبعاد ومقاييس) من بيانات العروضية والعيّنة والتوزيع والإجابات. |
| **الأرشيف** (Archive) | الأشهر السابقة، نسخ احتياطية (JSON أولًا مع تصدير XLSX اختياري محدود الحجم)، وحالة الاستعادة والتكامل. |
| **تصدير Power BI** | تصدير بصيغة CSV لبيانات العروضية والعيّنة والتوزيع والإجابات والتقرير التنفيذي، جاهزة للاستيراد المباشر في Power BI أو أي أداة BI خارجية. |
| **إدارة المستخدمين** (User Management) | إنشاء وإدارة حسابات الموظفين والمشرفين والمدراء، مصفوفة صلاحيات التبويبات والميزات، سجل النشاط، وسجل الإجراءات الأخيرة. |
| **الإعدادات** (Settings) | تخصيص أي نص/تسمية في الواجهة (تعريب قابل للتخصيص)، وعرض معلومات النظام والإصدار. |
| **سجل التغييرات** (ChangeLog) | سجل تغييرات داخل التطبيق نفسه، مبني مباشرة من ملفات `docs/edit logs/` — كل إصدار وتاريخه وما تغيّر فيه. |

---

### متطلبات المتصفح

يتطلب هذا التطبيق متصفحًا من عائلة **Chromium** (Chrome، أو Edge 92+) للعمل بكامل ميزاته. يعتمد على **File System Access API** (`showDirectoryPicker`) للقراءة والكتابة في مجلد مساحة العمل على جهازك. المتصفحات الأخرى (Firefox، Safari) غير مدعومة.

### المتطلبات الأساسية

- **Node.js** بإصدار 20 أو أحدث للتطوير المحلي.
- مكتبة **SheetJS** (`xlsx`) مرفقة محليًا داخل المستودع (`vendor/xlsx-0.20.3.tgz`)، لذا لا يحتاج `npm install`/`npm ci` اتصالًا بالإنترنت لجلبها كما كان الحال سابقًا؛ الاتصال بالإنترنت ما زال مطلوبًا فقط لبقية الحزم من سجل npm العادي.
- متصفح **Chromium** (Chrome أو Edge) لتشغيل التطبيق.

### البدء السريع

```bash
# تثبيت الاعتماديات
npm install

# تشغيل خادم التطوير
npm run dev

# افتح التطبيق في Chrome أو Edge على http://localhost:5173
```

### البناء والتوزيع

```bash
npm run build
```

ينتج ملفًا واحدًا قائمًا بذاته `dist/index.html` (~3.18 ميجابايت خام، ~1.17 ميجابايت مضغوط gzip — حسب v59.24). يمكن لهذا الملف أن:

- يُفتح مباشرة في أي متصفح Chromium (بدون خادم).
- يُوزَّع عبر البريد الإلكتروني أو USB أو أي خدمة مشاركة ملفات.
- يُستضاف على خادم HTTP ثابت (static).

مبني بواسطة Vite لإعادة تحميل سريعة أثناء التطوير (HMR)، ومُجمَّع في ملف واحد عبر `vite-plugin-singlefile`.

### الأوامر المتاحة

| الأمر | الغرض |
|---|---|
| `npm run dev` | تشغيل خادم Vite للتطوير على `http://localhost:5173` |
| `npm run build` | ترجمة TypeScript وبناء ملف `dist/index.html` واحد قائم بذاته |
| `npm run preview` | معاينة الملف المبني محليًا قبل التوزيع |
| `npm run lint` | فحص الأسلوب والأخطاء عبر ESLint |
| `npm run typecheck` | فحص TypeScript الصارم (`tsc --noEmit`) |
| `npm run test:run` | تشغيل كل اختبارات Vitest مرة واحدة |
| `npm run test` | تشغيل الاختبارات في وضع المراقبة (watch) |
| `npm run check:bundle-size` | التحقق من ميزانية حجم `dist/index.html` (خام/مضغوط) |
| `npm run check:release` | التأكد من تطابق إصدار `package.json` مع أحدث سجل تعديل |
| `npm run check:vendor` | التحقق من بصمة SHA-256 لحزمة SheetJS المرفقة |

### نظرة عامة على البنية

تطبيق React من جهة العميل بالكامل، بدون أي خادم خلفي. تُخزَّن البيانات على طبقتين:

1. **تخزين المتصفح** — حالة الجلسة تُحفظ في `sessionStorage` (تبقى بعد إعادة تحميل الصفحة، وتُمسح تلقائيًا عند إغلاق التبويب/المتصفح، مع صلاحية احتياطية سبعة أيام). المستخدمون المُدارون ومصفوفة الأدوار↔الصلاحيات يعيشون في متغيّر تشغيلي بالذاكرة يُزامَن مع ملف على القرص داخل مساحة العمل (`3-user-data/users.permissions.json`) — وليس في `localStorage`؛ فقط تخصيصات تسميات الواجهة تُحفظ في `localStorage`.
2. **مجلد مساحة العمل على القرص** — بيانات العروضية والعيّنات وتعيينات التوزيع وإجابات الموظفين تُخزَّن كملفات JSON في مجلد يختاره المستخدم عبر File System Access API. الملفات محمية بطبقة كتابة آمنة (لقطة ← تحقق ← اعتماد) وترقيم إصدار للمخطط.

**حزمة التقنيات:** React 19 · TypeScript (وضع صارم) · Vite · Vitest · lucide-react للأيقونات · SheetJS (`xlsx`، مرفقة محليًا) · hash-wasm (Argon2id) · d3-scale/d3-shape (لحساب الرسوم البيانية SVG الأصلية).

### الأدوار والصلاحيات

يحتوي التطبيق على **5 أدوار**:

- **زائر (guest)** — اطّلاع فقط على أغلب التبويبات (العروضية، مساحة العمل، التقارير، الأرشيف، الإعدادات) دون صلاحية إنشاء أو تعديل أو إرسال أي بيانات.
- **موظف (employee)** — يرى الحالات المُسندة إليه فقط ويقدّم إجاباته.
- **مشرف (supervisor)** — يطّلع على التقارير والأرشيف ويعتمد طلبات الاستبدال؛ لا يدير المستخدمين.
- **مدير (manager)** — يدير حسابات الموظفين وصلاحياتهم؛ لا يُنشئ قوالب فحص جديدة.
- **مسؤول (admin)** — صلاحية كاملة: إنشاء القوالب، إدارة المستخدمين، وإعدادات النظام.

يُنشأ حساب **admin** ابتدائي برمز مرور مخزَّن داخل حزمة التطبيق نفسها. يستطيع المسؤولون إنشاء حسابات مُدارة (موظف، مشرف، مدير) بأسماء مستخدمين وكلمات مرور مخصّصة. تُشفَّر كلمات المرور الجديدة بخوارزمية **Argon2id** (معيار OWASP لعام 2026)؛ وتُرقَّى كلمات المرور القديمة (PBKDF2-SHA256) تلقائيًا عند أول تسجيل دخول ناجح.

**ملاحظة أمنية:** هذا تطبيق من جهة العميل بدون خادم خلفي. كل فحوصات الصلاحيات تعمل داخل المتصفح، وكل بيانات العمل ملفات JSON عادية على القرص. طبقة الصلاحيات وسيلة لتوجيه الواجهة، **وليست حدّ ثقة** — يمكن لمستخدم مُصرّ تعديل `localStorage` أو ملفات JSON مباشرة لرفع صلاحياته أو التلاعب بالبيانات.

### تخطيط مجلد مساحة العمل

```
الجذر (يختاره المستخدم)
├── 1-population/
│   └── {الشهر}-{اسم الشهر}-{السنة}/        # مثال: 5-may-2026
│       ├── month.manifest.json
│       ├── 1-raw/
│       │   ├── risk.raw.json
│       │   └── bi.raw.json                   # اختياري
│       └── 2-processed/
│           ├── population.final.json
│           └── processing.summary.json
├── 2-samples/
│   └── {الشهر}/
│       ├── 1-main/
│       │   ├── sample.master.json
│       │   ├── main.samples.json
│       │   ├── distribution.events/{eventId}.json   # سجل أحداث ثابت لا يُعدَّل
│       │   ├── distribution.log.json                 # إسقاط توافقي قديم
│       │   └── distribution.current.json             # لقطة مشتقة قابلة لإعادة البناء
│       ├── 2-employees/
│       │   ├── {username}.samples.json
│       │   └── {username}.answers.json
│       └── 3-approvals/
│           └── {supervisor}.decisions.json
├── 3-user-data/
│   └── users.permissions.json
├── 4-reports/
│   └── designs/                                # تصاميم مصمّم التقارير المحفوظة
├── 5-system/
│   ├── workspace.schema.json
│   ├── backups/{YYYY-MM-DDTHH-MM-SS}/
│   ├── audit/                                   # سجل الإجراءات
│   ├── notifications/
│   ├── feedback/
│   └── user-presets/
└── 6-templates/
    ├── {templateId}.json
    ├── templates.index.json
    └── template.selection.json
```

أسماء مجلدات الأشهر بالصيغة `{الشهر}-{اسم الشهر بالإنجليزية}-{السنة}` (مثل `5-May-2026`). المجلدات القديمة غير المرقّمة (`Population/`, `templates/`, `.system/`) لا تزال تُقرأ عند وجودها؛ ترحيل المخطط يتم بأسلوب "تجربة أولًا ثم نسخة احتياطية" ولا يحذف أو ينقل أي شيء بصمت.

### ملاحظات للمطوّرين

**تنظيم الكود:**
- `src/auth/` — المصادقة والجلسات وإدارة المستخدمين والأدوار والصلاحيات
- `src/data/` — طبقة البيانات: العروضية، أخذ العيّنات، التوزيع، القوالب، الإجابات، التقارير، النسخ الاحتياطي، تصدير Power BI، مصمّم التقارير، مساحة العمل
- `src/components/` — مكوّنات الواجهة ونظام التبويبات
- `src/workers/` — عامل الويب (Web Worker) الخاص بتحليل ملفات إكسل

**الاختبارات:** Vitest في بيئة Node، مع مساعد `createMemoryDirectory()` (في `src/data/storage/memoryDirectory.ts`) يحاكي واجهة نظام الملفات بالكامل في الذاكرة للاختبارات. عدد الاختبارات الحالي: **945 اختبارًا في 141 ملفًا** (حسب v59.24).

**أسلوب الكود:** TypeScript بالوضع الصارم، ESLint، `import type` للاستيرادات النوعية فقط، نصوص عربية فقط في الواجهة (أو عبر مفاتيح تسميات)، بدون أطر CSS خارجية (CSS عادي مجاور لكل مكوّن)، أيقونات lucide-react فقط (بدون رموز يونيكود أو إيموجي).

**إكسل وجداول البيانات:** SheetJS (`xlsx`) مرفقة محليًا في المستودع، تُحلَّل في Web Worker (`src/workers/workbookWorker.ts`) وتُعاد النتائج إلى الخيط الرئيسي كرسائل `progress` و`result`.

**الرسوم البيانية:** رسم SVG أصلي متجاوب (لا مكتبة رسوم بيانية خارجية) مع جدول موازٍ لقارئ الشاشة، يعتمد جزئيًا على `d3-scale`/`d3-shape` لحساب المقاييس والأشكال فقط.

### الدعم والتوثيق

- **CLAUDE.md** — دليل معماري شامل للمطوّرين (وأدوات الذكاء الاصطناعي المساعِدة في البرمجة)
- **AGENTS.md** — نسخة مكافئة موجّهة لأدوات وكيل الذكاء الاصطناعي الأخرى
- **docs/edit logs/** — سجل تاريخ الإصدارات الكامل، ملف Markdown واحد لكل يوم مع مقتطفات "قبل/بعد"
- **docs/product/RELEASE_CHECKLIST.md** — قائمة التحقق قبل إصدار نسخة جديدة
- **docs/architecture/data-system-report.md** — المرجع التفصيلي المعتمد لكل ملف ومسار في مساحة العمل

</div>

---

## English

### Overview

XQAP is a fully client-side single-page web app (no backend server) for quality-assurance teams reviewing X-ray images — the kind used to screen baggage or cargo at ports. The interface is Arabic and right-to-left (RTL) by default, and all business data is stored as plain JSON files inside a "workspace" folder the user picks on their own machine — no database, no server, no cloud account required.

### Goal

To let a quality-assurance team:

- Draw a statistically defensible random sample of X-ray images already reviewed by screeners.
- Assign independent inspectors to re-examine them against one shared, customizable inspection template.
- Track every assignment, replacement, and reassignment as a recorded event, never as an edit that erases what came before.
- Produce reports that prove the review process itself is sound and auditable.

All without needing an IT team to run servers or databases — a folder on disk is enough.

### Core Ideas

- **The golden path:** Import Excel → Process the population → Draw the sample → Distribute → Collect answers → Reports.
- **No backend:** the user-picked workspace folder is the single source of truth. Everything is portable JSON, protected by a safe-write layer (stage → verify → commit, with a `.bak` fallback).
- **Deterministic, auditable sampling:** a seeded RNG (Mulberry32) plus Hamilton apportionment, version-stamped so a historical draw is never silently "replayed" under different logic.
- **Append-only distribution history:** every assignment, replacement, and reassignment is its own event, never an overwrite, so the complete "who did what" history can always be reconstructed.
- **Template-driven inspection:** the questions inspectors answer are defined by an admin-editable template, not hard-coded, so the QA form can evolve without a code change.
- **Arabic-first, not an afterthought:** every user-facing string ships in Arabic by default (and is customizable via label overrides), because the intended users are Arabic-speaking QA teams.
- **Explicitly advisory security model:** roles and permissions steer the UI; they are not a hard trust boundary — documented clearly so it's never mistaken for enterprise-grade access control.

### Modules

| Module | What it does |
|---|---|
| **Population** | Import Excel files (risk data required, BI data optional) through a Web Worker that never blocks the UI; process, map columns, and validate; save a month snapshot; then draw a stratified random sample (Hamilton apportionment + Fisher-Yates shuffle) split by port and scan type (CertScan/NonCertScan); finally distribute sample rows to the inspection team. Also includes a "Data Accuracy" report that checks referential integrity across population → sample → distribution → answers. |
| **Employee Workspace** | The inspector's daily screen: their assigned referral queue, submitting inspection results, requesting/approving referral replacements, and the inspection form itself, built from the active template. |
| **Notification Center** | Workspace-wide broadcast notices from managers/admins that recipients must acknowledge, safely shared even when multiple people write to the same folder at once. |
| **Reports** | Ready-made, printable, self-contained HTML reports (sample, distribution, executive); KPI dashboards for supervisors/managers; and a Report Designer — a drag-and-drop canvas for building custom aggregate reports (dimensions & measures) from population, sample, distribution, and answer data. |
| **Archive** | Past months, backup snapshots (JSON-first, with optional size-bounded XLSX export), and restore/integrity status. |
| **Power BI Export** | CSV export of population, sample, distribution, answer, and executive-report rows, shaped for direct ingestion into Power BI or any other external BI tool. |
| **User Management** | Create and manage employee/supervisor/manager accounts, the tab/feature permission matrix, an activity log, and a recent-actions audit trail. |
| **Settings** | Override any UI label or string (customizable Arabic localization), and view system/version info. |
| **ChangeLog** | An in-app changelog built directly from the `docs/edit logs/` history — every version, its date, and what changed. |

---

### Browser Requirements

This app requires a **Chromium-based** browser (Chrome, or Edge 92+) to function fully. It relies on the **File System Access API** (`showDirectoryPicker`) to read and write to a workspace folder on your machine. Other browsers (Firefox, Safari) are not supported.

### Prerequisites

- **Node.js** ≥ 20 for local development.
- **SheetJS** (`xlsx`) is now vendored locally in the repo (`vendor/xlsx-0.20.3.tgz`), so `npm install`/`npm ci` no longer needs internet access to fetch it as it once did; internet access is still required only for the rest of the packages from the regular npm registry.
- A **Chromium** browser (Chrome or Edge) to run the app.

### Quick Start

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Open the app in Chrome or Edge at http://localhost:5173
```

### Build & Deployment

```bash
npm run build
```

Produces a single self-contained file at `dist/index.html` (~3.18 MB raw, ~1.17 MB gzipped — as of v59.24). This file can be:

- Opened directly in any Chromium browser (no server required).
- Distributed via email, USB, or any file-sharing service.
- Hosted on a static HTTP server.

Built with Vite for fast development HMR (hot module replacement), and bundled into a single file via `vite-plugin-singlefile`.

### Available Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the Vite dev server on `http://localhost:5173` |
| `npm run build` | Compile TypeScript and build a single self-contained `dist/index.html` |
| `npm run preview` | Preview the built file locally before deployment |
| `npm run lint` | Run ESLint to check code style and errors |
| `npm run typecheck` | Strict TypeScript check (`tsc --noEmit`) |
| `npm run test:run` | Run all Vitest tests once |
| `npm run test` | Run tests in watch mode |
| `npm run check:bundle-size` | Verify the `dist/index.html` raw/gzip size budget |
| `npm run check:release` | Confirm `package.json`'s version matches the latest edit-log entry |
| `npm run check:vendor` | Verify the vendored SheetJS tarball's SHA-256 fingerprint |

### Architecture Overview

A fully client-side React app, with no backend server. Data is persisted in two layers:

1. **Browser storage** — session state lives in `sessionStorage` (survives a page reload, auto-clears when the tab/browser closes, with a 7-day TTL as a secondary guard). Managed users and the role↔permission matrix live in an in-memory runtime variable synced to a workspace disk file (`3-user-data/users.permissions.json`) — not `localStorage`; only UI label overrides persist to `localStorage`.
2. **Workspace folder on disk** — population data, samples, distribution assignments, and employee answers are stored as JSON files in a folder the user selects via the File System Access API. Files are protected by a safe-write layer (snapshot → verify → commit) and schema versioning.

**Stack:** React 19 · TypeScript (strict mode) · Vite · Vitest · lucide-react icons · SheetJS (`xlsx`, vendored locally) · hash-wasm (Argon2id) · d3-scale/d3-shape (native SVG chart geometry).

### Roles & Permissions

The app has **5 user roles**:

- **guest** — read-only access across most tabs (population, workspace, reports, archive, settings); no create/edit/submit permissions.
- **employee** — can view only their assigned cases and submit answers.
- **supervisor** — can view reports and archive, and approve replacement requests; cannot manage users.
- **manager** — can manage employee accounts and permissions; cannot create new inspection templates.
- **admin** — full access, including template creation, user management, and system settings.

An initial **admin** account is bootstrapped with a passcode stored in the client bundle. Admins can create managed accounts (employee, supervisor, manager) with custom usernames and passwords. New passwords are hashed with **Argon2id** (OWASP 2026 baseline); legacy PBKDF2-SHA256 hashes are transparently upgraded on the next successful login.

**Security note:** this is a client-side app with no backend. All permission checks run in the browser, and all business data is plain JSON on disk. The permission layer is a **UX/routing guard, not a trust boundary** — a determined user can edit `localStorage` or the JSON files directly to self-elevate or tamper with data.

### Workspace Folder Layout

```
Root (user picks this folder)
├── 1-population/
│   └── {month}-{monthname}-{year}/            # e.g. 5-may-2026
│       ├── month.manifest.json
│       ├── 1-raw/
│       │   ├── risk.raw.json
│       │   └── bi.raw.json                    # optional
│       └── 2-processed/
│           ├── population.final.json
│           └── processing.summary.json
├── 2-samples/
│   └── {month}/
│       ├── 1-main/
│       │   ├── sample.master.json
│       │   ├── main.samples.json
│       │   ├── distribution.events/{eventId}.json   # immutable event log
│       │   ├── distribution.log.json                 # legacy compatibility projection
│       │   └── distribution.current.json             # rebuildable derived snapshot
│       ├── 2-employees/
│       │   ├── {username}.samples.json
│       │   └── {username}.answers.json
│       └── 3-approvals/
│           └── {supervisor}.decisions.json
├── 3-user-data/
│   └── users.permissions.json
├── 4-reports/
│   └── designs/                                 # saved Report Designer designs
├── 5-system/
│   ├── workspace.schema.json
│   ├── backups/{YYYY-MM-DDTHH-MM-SS}/
│   ├── audit/                                    # action log
│   ├── notifications/
│   ├── feedback/
│   └── user-presets/
└── 6-templates/
    ├── {templateId}.json
    ├── templates.index.json
    └── template.selection.json
```

Month folder names follow `{month}-{monthname-en}-{year}` (e.g. `5-May-2026`). Legacy unnumbered folders (`Population/`, `templates/`, `.system/`) are still read when present; schema migration is dry-run-first and backup-first, and never silently moves or deletes anything.

### Developer Notes

**Code organization:**
- `src/auth/` — authentication, sessions, user management, roles & permissions
- `src/data/` — data layer: population, sampling, distribution, templates, answers, reporting, backup, Power BI export, report designer, workspace
- `src/components/` — UI components and the tab system
- `src/workers/` — the Web Worker for Excel parsing

**Testing:** Vitest (Node environment), with a `createMemoryDirectory()` helper (`src/data/storage/memoryDirectory.ts`) that fully simulates the filesystem API in memory for tests. Current count: **945 tests across 141 files** (as of v59.24).

**Code style:** TypeScript strict mode, ESLint, `import type` for type-only imports, Arabic-only UI text (or via label keys), no CSS frameworks (plain CSS co-located per component), lucide-react for all icons (no Unicode symbols or emoji).

**Excel & sheets:** SheetJS (`xlsx`) is vendored locally in the repo, parsed in a Web Worker (`src/workers/workbookWorker.ts`), with results posted back to the main thread as `progress` and `result` messages.

**Charts & visualization:** native, responsive SVG (no external charting library) paired with a screen-reader table, using `d3-scale`/`d3-shape` only for scale/shape geometry calculations.

### Support & Documentation

- **CLAUDE.md** — comprehensive architecture guide for developers (and AI coding tools)
- **AGENTS.md** — an equivalent guide aimed at other AI agent tooling
- **docs/edit logs/** — complete version history, one dated Markdown file per day with before/after snippets
- **docs/product/RELEASE_CHECKLIST.md** — checklist to run through before cutting a release
- **docs/architecture/data-system-report.md** — the authoritative, detailed reference for every workspace file and path
