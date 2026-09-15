interface Evidence {
  version?: { product?: string };
  url?: string;
  events: Array<{
    kind?: string;
    url?: string;
    resource?: string;
    status?: number;
  }>;
}
/** Compare the earliest observable milestones; a status difference is not a causal attribution. */
export function compareBrowserEvidence(headed: Evidence, headless: Evidence) {
  const summarize = (e: Evidence) => {
    if (!Array.isArray(e.events)) throw Error("Invalid browser evidence");
    const homepage = e.events.find(
      (r) =>
        r.kind === "response" &&
        r.resource === "document" &&
        /^https:\/\/www\.(bet365|betano)\.bet\.br\/$/.test(r.url ?? ""),
    );
    const list = e.events.filter((r) =>
      /othersportsmatchmarketscontentapi\/list|\/api\/sport\/esports\//.test(
        r.url ?? "",
      ),
    );
    const detail = e.events.filter((r) =>
      /othersportsmatchbettingcontentapi\/coupon|\/api\/odds\//.test(
        r.url ?? "",
      ),
    );
    return {
      chrome: e.version?.product ?? null,
      homepageStatus: homepage?.status ?? null,
      listEmitted: list.some((r) => r.kind === "request"),
      listStatuses: list
        .filter((r) => r.kind === "response")
        .map((r) => r.status),
      detailEmitted: detail.some((r) => r.kind === "request"),
    };
  };
  const a = summarize(headed),
    b = summarize(headless);
  const firstDifference =
    a.homepageStatus !== b.homepageStatus
      ? "homepage_http_status"
      : a.listEmitted !== b.listEmitted
        ? "list_request_emission"
        : JSON.stringify(a.listStatuses) !== JSON.stringify(b.listStatuses)
          ? "list_http_status"
          : a.detailEmitted !== b.detailEmitted
            ? "detail_request_emission"
            : null;
  return {
    headed: a,
    headless: b,
    firstDifference,
    sharedHomepageFailure:
      a.homepageStatus === b.homepageStatus && (a.homepageStatus ?? 0) >= 400,
    conclusion:
      "Observed milestones only; server-side cause and feed validity are not inferred",
  };
}
