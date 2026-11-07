export const LIMITS = {
  maxRowsPerDataset: 2_000_000, // provisional: fix by measurement, Milestone 3
  maxSlides: 200, // provisional: fix by measurement, Milestone 3
  maxVisualsPerPage: 40, // provisional: fix by measurement, Milestone 3
  maxChartCategories: 12, // provisional: fix by measurement, Milestone 3
  maxTableCellsPerPage: 240, // provisional: fix by measurement, Milestone 3
  maxFormulaLength: 2_000, // provisional: fix by measurement, Milestone 3
  maxFormulaDepth: 32, // provisional: fix by measurement, Milestone 3
  issueTimeBudgetMs: 120_000, // provisional: fix by measurement, Milestone 3
} as const;

export const LIMITS_STATUS = "provisional" as const;
