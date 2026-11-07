import type { CatalogDesign, SlotDecl } from "../types";
import { GRID, NOTE_SLOT } from "./shared";

/**
 * Numbers 10 to 17, reserved. Each carries its final slots, frozen in numbers.lock.ts now, and no visuals:
 * the visual arrives in Milestone 2 and must fit these slots (a changed slot means a new number).
 */
const planned = (number: number, nameAr: string, descriptionAr: string, deck3Source: string, slots: SlotDecl[]): CatalogDesign => ({
  number, nameAr, descriptionAr, deck3Source, status: "planned", slots, page: { grid: GRID, visuals: [] },
});

const text = (id: string, nameAr: string, required: boolean): SlotDecl => ({ id, nameAr, kind: "text", required });
const dim = (id: string, nameAr: string, required: boolean): SlotDecl => ({ id, nameAr, kind: "dimension", required });
const measure = (id: string, nameAr: string, required: boolean): SlotDecl => ({ id, nameAr, kind: "measure", required });

/** coverSlide and closingSlide share deck3's meta row of short facts under the title (coverMetaRow). */
const metaSlots = (): SlotDecl[] => [
  text("meta1", "البيان الأول", false), text("meta2", "البيان الثاني", false), text("meta3", "البيان الثالث", false),
];

export const PLANNED: readonly CatalogDesign[] = [
  // The logo and organisation lines come from the org block (theme), not from a slot. No foot (hideFoot).
  planned(10, "الغلاف", "شريحة الغلاف: شعار الجهة واسمها، ثم عنوان التقرير وفترته، وتحتها بيانات مختصرة.", "coverSlide", [
    text("kicker", "تمهيد العنوان", false), text("heading", "عنوان التقرير", true),
    text("periodLabel", "اسم الفترة", false), text("periodValue", "الفترة", true), ...metaSlots(),
  ]),
  // Rows are built from the report's own section dividers and their pages.
  planned(11, "المحتويات", "قائمة أقسام التقرير بأرقامها ووصف كل قسم وصفحاته، تبنى من صفحات التقرير نفسه.", "contentsSlide", [
    text("heading", "عنوان المحتويات", false), NOTE_SLOT,
  ]),
  planned(12, "أعمدة مجمعة", "مخطط أعمدة يقارن مقياسين متجاورين لكل فئة من فئات حقل واحد.", "groupedBarChart", [
    dim("category", "الفئة", true), measure("valueA", "المقياس الأول", true), measure("valueB", "المقياس الثاني", true),
    measure("categoryOrder", "ترتيب الفئات", false), NOTE_SLOT,
  ]),
  planned(13, "مصفوفة الجودة", "مصفوفة صفوفها فئة وأعمدتها فئة أخرى، في كل خلية نسبة كبيرة بمسار تعبئة ورقمان تحتها.", "qualityMatrix + matrixGrid", [
    dim("rowGroup", "فئة الصفوف", true), dim("columnGroup", "فئة الأعمدة", true),
    measure("rate", "النسبة الرئيسية", true), measure("stat1", "الرقم الأول", false), measure("stat2", "الرقم الثاني", false), NOTE_SLOT,
  ]),
  planned(14, "جدول الملاحظات", "جدول مرقم لكل ملاحظة نصها وأرقامها والتوصية المقابلة لها.", "observationsTable", [
    dim("observation", "الملاحظة", true), dim("recommendation", "التوصية", true),
    measure("figure1", "رقم الملاحظة الأول", false), measure("figure2", "رقم الملاحظة الثاني", false),
    measure("rowOrder", "ترتيب الصفوف", false), NOTE_SLOT,
  ]),
  planned(15, "تعريف المستوى", "أعمدة لكل مستوى: اسمه ووصفه وتعريفه ومحدداته، مع رقم بارز في الأسفل.", "levelDefinitionSlide", [
    dim("level", "المستوى", true), dim("subtitle", "وصف المستوى", false), dim("definition", "تعريف المستوى", true),
    dim("determinant", "محددات المستوى", false), measure("weight", "وزن المستوى", false),
    text("highlight", "الرقم البارز", false), text("highlightNote", "شرح الرقم البارز", false), NOTE_SLOT,
  ]),
  planned(16, "الاتجاه الشهري", "مخطط خطي لمقياس عبر الأشهر، بخط لكل فئة عند الحاجة.", "line chart (new in Milestone 2)", [
    dim("period", "الفترة", true), measure("value", "القيمة", true), dim("series", "فئة الخطوط", false),
    measure("periodOrder", "ترتيب الفترات", false), NOTE_SLOT,
  ]),
  // deck3's org-block closing (R7), not a filler slide. No foot (hideFoot).
  planned(17, "الختام وبيانات الجهة", "شريحة الختام: شعار الجهة واسمها وبياناتها، وعبارة ختام وبيانات مختصرة.", "closingSlide + orgBlockHtml", [
    text("kicker", "تمهيد العنوان", false), text("heading", "عنوان الختام", true), text("closingLine", "عبارة الختام", false), ...metaSlots(),
  ]),
];
