import { test } from "node:test";
import assert from "node:assert/strict";
import { PersistenceController } from "../../persistence/persistence.controller.js";
import type { OddsReadRepository } from "../../persistence/repositories/read.repository.js";
import type { DataIssuesRepository } from "../../persistence/repositories/issues.repository.js";

const id = "00000000-0000-0000-0000-000000000001";
test("SQL read API presents numeric original odds and a separate display field", async () => {
  const snapshot = { odds: { toString: () => "1.5556" } };
  const read = {
    events: async () => [
      {
        id,
        matches: [
          {
            providerEvent: {
              markets: [{ selections: [{ snapshots: [snapshot] }] }],
            },
          },
        ],
      },
    ],
    history: async () => [snapshot, { odds: null }],
  } as unknown as OddsReadRepository;
  const controller = new PersistenceController(
    read,
    {} as DataIssuesRepository,
  );
  const event = await controller.event(id);
  const point =
    event.matches[0].providerEvent.markets[0].selections[0].snapshots[0];
  assert.equal(point.odds, 1.5556);
  assert.equal(point.displayOdds, "1,56");
  const history = await controller.history(id);
  assert.equal(history[0].odds, 1.5556);
  assert.equal(history[0].displayOdds, "1,56");
  assert.equal(history[1].odds, null);
  assert.equal(history[1].displayOdds, null);
  assert.equal(snapshot.odds.toString(), "1.5556");
});
