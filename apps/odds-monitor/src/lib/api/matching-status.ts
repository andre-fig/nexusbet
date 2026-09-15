export enum MatchingStatus {
  Matched = "matched",
  Partial = "partial",
  Unmatched = "unmatched",
  LowConfidence = "low_confidence",
  NotApplicable = "not_applicable",
  Manual = "manual",
}

export const matchingFilterStatuses = [
  MatchingStatus.Matched,
  MatchingStatus.Partial,
  MatchingStatus.Unmatched,
  MatchingStatus.LowConfidence,
  MatchingStatus.NotApplicable,
] as const;

export function matchingStatusColors(status: MatchingStatus): string {
  switch (status) {
    case MatchingStatus.Matched:
      return "text-match-matched bg-match-matched-bg";
    case MatchingStatus.Partial:
      return "text-match-partial bg-match-partial-bg";
    case MatchingStatus.Unmatched:
      return "text-match-unmatched bg-match-unmatched-bg";
    case MatchingStatus.LowConfidence:
      return "text-match-low-confidence bg-match-low-confidence-bg";
    case MatchingStatus.NotApplicable:
      return "text-match-not-applicable bg-match-not-applicable-bg";
    case MatchingStatus.Manual:
      return "text-primary bg-surface-container-high";
  }
}
