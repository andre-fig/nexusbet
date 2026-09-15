export type DataHealthStatus = "healthy" | "degraded" | "critical";
export type IssueScope = "event" | "provider" | "system";

export interface HealthIssue {
  type: string;
  severity: string;
  details?: unknown;
  providerId?: string | null;
  providerEventId?: string | null;
  canonicalEventId?: string | null;
  marketId?: string | null;
  eventKey?: string | null;
}

const systemicTypes = new Set([
  "EVENT_COUNT_DROP",
  "COLLECTION_PARTIAL_FAILURE",
  "COLLECTION_GLOBAL_FAILURE",
  "PARSER_FAILURE",
  "MASS_INVALID_DATA",
]);
const localTypes = new Set([
  "UNMATCHED_EVENT",
  "PARTIAL_MATCH",
  "LOW_CONFIDENCE",
  "ODD_OUTLIER",
  "OUTLIER",
  "MARKET_UNAVAILABLE",
  "MARKET_INCOMPLETE",
  "STALE",
]);

export function issueImpact(issue: HealthIssue): {
  scope: IssueScope;
  systemic: boolean;
} {
  const details =
    issue.details &&
    typeof issue.details === "object" &&
    !Array.isArray(issue.details)
      ? (issue.details as Record<string, unknown>)
      : {};
  const explicitScope = details.scope;
  const scope: IssueScope =
    explicitScope === "event" ||
    explicitScope === "provider" ||
    explicitScope === "system"
      ? explicitScope
      : localTypes.has(issue.type) ||
          issue.providerEventId ||
          issue.canonicalEventId ||
          issue.marketId
        ? "event"
        : issue.providerId
          ? "provider"
          : "system";
  return {
    scope,
    systemic:
      details.systemic === true ||
      (details.systemic !== false &&
        (scope === "system" ||
          systemicTypes.has(issue.type) ||
          details.essential === true)),
  };
}

export function assessDataHealth(input: {
  providers: {
    id: string;
    active: boolean;
    status: string;
    statusReason: string;
    stale: boolean;
    eventCount: number;
  }[];
  issues: HealthIssue[];
  eventCount: number;
}): { status: DataHealthStatus; reasons: string[] } {
  const active = input.providers.filter((provider) => provider.active);
  const downOrNoData = active.filter(
    (provider) =>
      provider.status === "unavailable" || provider.eventCount === 0,
  );
  const providerProblems = active.filter(
    (provider) =>
      provider.stale ||
      provider.status === "stale" ||
      provider.status === "unavailable" ||
      provider.status === "degraded" ||
      provider.eventCount === 0,
  );
  const systemicIssues = input.issues.filter(
    (issue) => issueImpact(issue).systemic,
  );
  const criticalIssues = systemicIssues.filter(
    (issue) => issue.severity === "critical",
  );
  const warningIssues = systemicIssues.filter(
    (issue) => issue.severity === "warning" || issue.severity === "error",
  );
  const incompleteEvents = new Set(
    input.issues
      .filter((issue) => issue.type === "MARKET_INCOMPLETE")
      .map(
        (issue) =>
          issue.eventKey ?? issue.canonicalEventId ?? issue.providerEventId,
      )
      .filter((key): key is string => !!key),
  );
  const significantIncomplete =
    incompleteEvents.size >= 3 &&
    incompleteEvents.size / Math.max(input.eventCount, 1) >= 0.1;

  const allProvidersWithoutData =
    active.length > 0 && downOrNoData.length === active.length;
  if (
    criticalIssues.length ||
    downOrNoData.length >= 2 ||
    allProvidersWithoutData
  )
    return {
      status: "critical",
      reasons: [
        ...(criticalIssues.length
          ? [`${criticalIssues.length} systemic critical issue(s)`]
          : []),
        ...(downOrNoData.length >= 2 || allProvidersWithoutData
          ? [`${downOrNoData.length} active providers down or without data`]
          : []),
      ],
    };
  if (providerProblems.length || warningIssues.length || significantIncomplete)
    return {
      status: "degraded",
      reasons: [
        ...providerProblems.map(
          (provider) =>
            `${provider.id}: ${provider.status === "healthy" ? "no data" : provider.status}`,
        ),
        ...(warningIssues.length
          ? [`${warningIssues.length} systemic warning(s)`]
          : []),
        ...(significantIncomplete
          ? [`Incomplete markets affect ${incompleteEvents.size} events`]
          : []),
      ],
    };
  return { status: "healthy", reasons: [] };
}
