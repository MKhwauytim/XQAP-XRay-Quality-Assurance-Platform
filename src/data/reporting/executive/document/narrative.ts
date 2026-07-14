// Data-driven executive-close generators (blueprint §1.7 / §4).
// Each returns the three close lines (ما تظهره البيانات / لماذا يهم / الإجراء المطلوب)
// from ReportModel numbers — never hand-written prose. Pure functions.

import { fmtNum, fmtPct } from "../primitives";

export type CloseLines = { shows: string; matters: string; action: string };

function pct(n: number | null): string {
  return n === null ? "غير متاح" : fmtPct(n);
}

export function populationClose(total: number, suspicionRate: number, portCount: number): CloseLines {
  return {
    shows: `يضم مجتمع الدراسة ${fmtNum(total)} صورة موزعة على ${fmtNum(portCount)} منفذًا، بنسبة اشتباه ${pct(suspicionRate)}.`,
    matters: "حجم المجتمع وتوزيعه يحددان تمثيلية النتائج ومجالات تركيز التدقيق.",
    action: "اعتماد المجتمع أساسًا للتحليل، ومراجعة المنافذ ذات الكثافة العالية أولًا.",
  };
}

export function coverageClose(coverage: number, completion: number): CloseLines {
  return {
    shows: `بلغت تغطية العينة ${pct(coverage)} وإنجاز الدراسة ${pct(completion)}.`,
    matters: "اكتمال الدراسة شرط لموثوقية مؤشرات الدقة اللاحقة.",
    action: completion >= 95 ? "متابعة الإنجاز الكامل للفترة القادمة." : "استكمال الصور غير المدروسة قبل اعتماد النتائج النهائية.",
  };
}

export function accuracyClose(accuracy: number | null, detection: number | null, missed: number | null): CloseLines {
  return {
    shows: `دقة الفحص ${pct(accuracy)} ومعدل اكتشاف الاشتباه ${pct(detection)} ونسبة الاشتباه الفائت ${pct(missed)}.`,
    matters: "الاشتباه الفائت يمثل الخطر الأمني الأعلى لأنه تهديد مُرّر دون كشف.",
    action: missed !== null && missed > 5
      ? "تحديد المنافذ والمفتشين الأكثر مساهمة في الاشتباه الفائت وإطلاق إجراء تصحيحي."
      : "الحفاظ على مستوى الكشف الحالي ومتابعة المؤشرات دوريًا.",
  };
}

export function portAccuracyClose(best: string | null, weakest: string | null, insufficientCount: number): CloseLines {
  return {
    shows: best
      ? `أعلى دقة في ${best}${weakest ? `، وأدنى دقة في ${weakest}` : ""}.`
      : "لا توجد منافذ كافية البيانات للترتيب هذه الفترة.",
    matters: "تفاوت الدقة بين المنافذ يوجّه أولويات التدريب والإشراف.",
    action: insufficientCount > 0
      ? `${fmtNum(insufficientCount)} منفذًا ببيانات غير كافية لا يُرتَّب؛ يُكتفى بوصفه ويُعزَّز حجمه.`
      : "توجيه الدعم إلى المنافذ الأدنى دقة.",
  };
}

export function levelClose(l1: number | null, l2: number | null, correction: number | null, regression: number | null): CloseLines {
  return {
    shows: `دقة المستوى الأول ${pct(l1)} والمستوى الثاني ${pct(l2)} (تصحيح ${pct(correction)} / تراجع ${pct(regression)}).`,
    matters: "مراجعة المستوى الثاني تهدف لتصحيح أخطاء المستوى الأول دون إدخال أخطاء جديدة.",
    action: (regression ?? 0) > (correction ?? 0)
      ? "مراجعة فاعلية المستوى الثاني لأن التراجع يفوق التصحيح."
      : "الإبقاء على آلية المراجعة المزدوجة مع متابعة معدلات التصحيح.",
  };
}

export function qualityClose(highRate: number | null, markingRate: number | null): CloseLines {
  return {
    shows: `الجودة المقبولة ${pct(highRate)} ووجود التحديد ${pct(markingRate)}.`,
    matters: "جودة الصورة ووجود التحديد يرتبطان بدقة القرار (ارتباط لا سببية).",
    action: "تحسين جودة الالتقاط والتحديد في المنافذ ذات الجودة المنخفضة.",
  };
}

export function corroborationClose(reportingTeams: number, topTeam: string | null, topRate: number | null): CloseLines {
  return {
    shows: reportingTeams > 0
      ? `${fmtNum(reportingTeams)} فرق قدّمت نتائج؛ أعلى توافق مع المراجع${topTeam ? ` لفريق ${topTeam}` : ""} (${pct(topRate)}).`
      : "لم تقدّم الفرق الأخرى نتائج كافية للمقارنة هذه الفترة.",
    matters: "توافق الفرق الأخرى مع المراجع يعزز الثقة في صحة قرارات المستويين.",
    action: "استخدام تطابق الفرق كدليل مساند عند مراجعة قرارات الاشتباه الفائت.",
  };
}

export function employeeClose(mapped: boolean, evaluated: number, avgAccuracy: number | null): CloseLines {
  if (!mapped) {
    return {
      shows: "هوية المفتش غير مرتبطة (لم تتم مطابقة BI)، لذا يتعذر إسناد الدقة للمفتشين.",
      matters: "المساءلة الفردية تتطلب ربط هوية المفتش من بيانات BI.",
      action: "إكمال مطابقة BI لربط القرارات بالمفتشين في الفترة القادمة.",
    };
  }
  return {
    shows: `تم تقييم ${fmtNum(evaluated)} مفتشًا بمتوسط دقة ${pct(avgAccuracy)}.`,
    matters: "تحديد المفتشين الأعلى والأدنى دقة يوجّه التقدير والتدريب.",
    action: "تكريم المتميزين وتوجيه دعم مركّز للأقل دقة.",
  };
}

export function errorClose(missed: number, falseSusp: number, evaluable: number): CloseLines {
  return {
    shows: `من ${fmtNum(evaluable)} قرار قابل للتقييم: ${fmtNum(missed)} اشتباه فائت و${fmtNum(falseSusp)} اشتباه خاطئ.`,
    matters: "تركّز الأخطاء في أنواع ومنافذ محددة يكشف الأسباب الجذرية.",
    action: "معالجة المنافذ الأكثر مساهمة في الاشتباه الفائت كأولوية أمنية.",
  };
}
