/** Where the comprehensive report's rows come from. Defined once; imported by the page, switch and stats. */
export type ComprehensiveSourceMode = "app+excel" | "excel-only";

export const DEFAULT_SOURCE_MODE: ComprehensiveSourceMode = "app+excel";
