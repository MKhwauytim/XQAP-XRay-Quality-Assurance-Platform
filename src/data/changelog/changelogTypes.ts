/** One of the four buckets the "سجل التحديثات" tab groups entries into. */
export type ChangelogBucket = "fix" | "feature" | "enhancement" | "redesign";

/** A single entry extracted from an edit-log heading (see generate-changelog-data.mjs). */
export type ChangelogEntry = {
  version: string;
  date: string;
  bucket: ChangelogBucket;
  scope: string | null;
  title: string;
};
