export const BI_COLUMN_ALIASES = {
  xrayImageId: [
    "معرف الأشعة",
    "معرف الاشعة",
    "رقم صورة الأشعة",
    "رقم صورة الاشعة",
    "XRAY_SCAN_ID"
  ],

  xrayEntryDate: [
    "تاريخ دخول الأشعة",
    "تاريخ دخول الاشعة",
    "تاريخ الاشعة",
    "تاريخ الأشعة",
    "تاريخ الاشعه",
    "تاريخ الأشعه"
  ],

  portType: ["نوع المنفذ"],

  portCode: ["رمز المنفذ", "رمز الجمرك", "PORT_CD"],

  portName: ["اسم المنفذ"],

  declarationNumber: ["رقم البيان"],

  preliminaryDeclarationNumber: [
    "رقم المبدئي للبيان",
    "رقم البيان المبدئي",
    "رقم المبدئي للبيان"
  ],

  declarationDate: [
    "تاريخ البيان",
    "تاريخ البيان ميلادي"
  ],

  declarationHijriDate: [
    "تاريخ البيان هجري",
    " تاريخ البيان هجري"
  ],

  inboundOutboundType: [
    "بيان وارد /صادر",
    "البيان وارد /صادر",
    "البيان وارد/صادر",
    "وارد/صادر",
    "بيان وارد/صادر"
  ],

  declarationType: ["نوع البيان"],

  declarationStatus: ["حالة البيان"],

  plateOrContainerNumber: [
    "رقم الحاوية",
    "CNTNR_MRK",
    "PLATE_NO",
    "رقم اللوحة",
    "رقم اللوحة\\الحاوية",
    "رقم اللوحة/الحاوية"
  ],

  chassisNumber: ["رقم الشاص", "رقم الهيكل"],

  governance: ["الحوكمة"],

  levelOneEmployee: [
    "موظف المستوى الأول",
    "موظف المستوى الاول"
  ],

  levelTwoEmployee: ["موظف المستوى الثاني"],

  levelOneResultCode: [
    "كود نتيجة المستوى الأول",
    "كود نتيجة المستوى الاول"
  ],

  levelTwoResultCode: ["كود نتيجة المستوى الثاني"],

  levelOneResult: [
    "نتيجة المستوى الأول",
    "نتيجة المستوى الاول",
    "المستوى الأول",
    "المستوى الاول",
    "نتيجة المستوى الأول للأشعة",
    "نتيجة المستوى الاول للاشعة"
  ],

  levelTwoResult: [
    "نتيجة المستوى الثاني",
    "المستوى الثاني",
    "نتيجة المستوى الثاني للأشعة",
    "نتيجة المستوى الثاني للاشعة"
  ],

  manualInspectionResultCode: [
    "كود نتيجة التفتيش اليدوي",
    "كود نتيجة الفتيش اليدوي"
  ],

  manualInspectionResult: [
    "نتيجة التفتيش اليدوي",
    "نتيجة الفتيش اليدوي"
  ],

  oppositeInspectionEmployee: ["موظف التفتيش المعاكس"],

  oppositeInspectionResultCode: ["كود نتيجة التفتيش المعاكس"],

  oppositeInspectionResult: ["نتيجة التفتيش المعاكس"],

  liveMeansEmployee: ["موظف الوسائل الحية"],

  liveMeansResultCode: ["كود نتيجة الوسائل الحية"],

  liveMeansResult: ["نتيجة الوسائل الحية"],

  notes: [
    "ملاحظة المستويات",
    "INTRNL_INSPCT_REMARKS"
  ]
} as const;
