import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessDataHealth,
  issueImpact,
  type HealthIssue,
} from "../data-health.js";

const provider = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  active: true,
  status: "healthy",
  statusReason: "active",
  stale: false,
  eventCount: 10,
  ...overrides,
});
const baseProviders = [
  provider("superbet"),
  provider("blaze"),
  provider("estrelabet"),
];
const health = (
  issues: HealthIssue[] = [],
  providers = baseProviders,
  eventCount = 30,
) => assessDataHealth({ providers, issues, eventCount });

test("event-level issues keep Data Health healthy and remain classified for Needs attention", () => {
  const issues: HealthIssue[] = [
    { type: "UNMATCHED_EVENT", severity: "info", providerEventId: "event:1" },
    { type: "PARTIAL_MATCH", severity: "warning", canonicalEventId: "event:2" },
    { type: "LOW_CONFIDENCE", severity: "warning", providerEventId: "event:3" },
    {
      type: "MARKET_INCOMPLETE",
      severity: "warning",
      marketId: "market:1",
      providerEventId: "event:4",
    },
    { type: "ODD_OUTLIER", severity: "warning", providerEventId: "event:5" },
    { type: "MARKET_UNAVAILABLE", severity: "warning" },
  ];
  assert.equal(health(issues).status, "healthy");
  assert.ok(
    issues.every(
      (issue) =>
        issueImpact(issue).scope === "event" && !issueImpact(issue).systemic,
    ),
  );
});

test("one active stale or no-data provider degrades Data Health", () => {
  assert.equal(
    health(
      [],
      [
        provider("superbet", { stale: true, status: "stale" }),
        ...baseProviders.slice(1),
      ],
    ).status,
    "degraded",
  );
  assert.equal(
    health(
      [],
      [provider("superbet", { eventCount: 0 }), ...baseProviders.slice(1)],
    ).status,
    "degraded",
  );
});

test("systemic warnings degrade Data Health even when event issues are local", () => {
  const warning: HealthIssue = {
    type: "PARSER_FAILURE",
    severity: "warning",
    providerId: "provider:1",
    details: { scope: "provider", systemic: true },
  };
  assert.deepEqual(issueImpact(warning), { scope: "provider", systemic: true });
  assert.equal(health([warning]).status, "degraded");
  assert.equal(
    health([
      {
        type: "EVENT_COUNT_DROP",
        severity: "warning",
        providerId: "provider:1",
      },
    ]).status,
    "degraded",
  );
});

test("critical systemic issue or multiple providers without data makes Data Health critical", () => {
  const critical: HealthIssue = {
    type: "COLLECTION_GLOBAL_FAILURE",
    severity: "critical",
    details: { scope: "system", systemic: true },
  };
  assert.equal(health([critical]).status, "critical");
  assert.equal(
    health([
      {
        type: "PROVIDER_DOWN",
        severity: "critical",
        providerId: "provider:1",
        details: { scope: "provider", essential: true },
      },
    ]).status,
    "critical",
  );
  assert.equal(
    health(
      [],
      [
        provider("superbet", { eventCount: 0 }),
        provider("blaze", { status: "unavailable" }),
        provider("estrelabet"),
      ],
    ).status,
    "critical",
  );
  assert.equal(
    health([
      {
        ...critical,
        details: { scope: "event", systemic: false },
        providerEventId: "event:1",
      },
    ]).status,
    "healthy",
  );
});

test("incomplete markets must affect several events before degrading globally", () => {
  const incomplete = (id: string): HealthIssue => ({
    type: "MARKET_INCOMPLETE",
    severity: "warning",
    providerEventId: id,
    eventKey: id,
  });
  assert.equal(health([incomplete("a")]).status, "healthy");
  assert.equal(
    health([incomplete("a"), incomplete("b"), incomplete("c")]).status,
    "degraded",
  );
  assert.equal(
    health(
      [incomplete("a"), incomplete("b"), incomplete("c")],
      baseProviders,
      100,
    ).status,
    "healthy",
  );
});
