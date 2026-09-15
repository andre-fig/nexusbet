import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const service = join(root, "..", "odds-service", "src", "modules");
const bundle = await build({
  entryPoints: [join(root, "src", "normalizers.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "chrome120",
});
const normalizers = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const fixture = async (provider, name) =>
  JSON.parse(await readFile(join(service, provider, "fixtures", name), "utf8"));

test("the standalone browser bundle preserves all five provider listings", async () => {
  const cases = [
    [
      "bet365",
      normalizers.normalizeBet365(await fixture("bet365", "cs2.json")),
    ],
    [
      "betano",
      normalizers.normalizeBetano(
        await fixture("betano", "cs2-list.json"),
        "cs2",
      ),
    ],
    [
      "superbet",
      normalizers.normalizeSuperbet(
        await fixture("superbet", "cs2-list.json"),
        "cs2",
        await fixture("superbet", "structure.json"),
      ),
    ],
    [
      "blaze",
      normalizers.normalizeBlaze(
        await fixture("blaze", "prematch.json"),
        "cs2",
      ),
    ],
    [
      "estrelabet",
      normalizers.normalizeEstrelaBet(
        await fixture("estrelabet", "list.json"),
        "cs2",
      ),
    ],
  ];
  for (const [provider, events] of cases) {
    assert.ok(events.length > 0, `${provider} returned no events`);
    assert.ok(events.every((e) => e.eventId && e.esport === "cs2"));
    assert.equal(new Set(events.map((e) => e.eventId)).size, events.length);
  }
});

test("a Chrome-built publication passes the Railway ingestion contract", async () => {
  const publicationBundle = await build({
    entryPoints: [join(root, "src", "publication.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "chrome120",
  });
  const browser = await import(
    `data:text/javascript;base64,${Buffer.from(publicationBundle.outputFiles[0].text).toString("base64")}`
  );
  const serverBundle = await build({
    entryPoints: [
      join(
        root,
        "..",
        "odds-service",
        "src",
        "modules",
        "runtime",
        "wire-payload.ts",
      ),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  const server = await import(
    `data:text/javascript;base64,${Buffer.from(serverBundle.outputFiles[0].text).toString("base64")}`
  );
  const structure = await fixture("superbet", "structure.json");
  const cases = [
    [
      "superbet",
      await fixture("superbet", "cs2-list.json"),
      (capture) => normalizers.normalizeSuperbet(capture, "cs2", structure),
    ],
    [
      "blaze",
      await fixture("blaze", "prematch.json"),
      (capture) => normalizers.normalizeBlaze(capture, "cs2"),
    ],
    [
      "estrelabet",
      await fixture("estrelabet", "list.json"),
      (capture) => normalizers.normalizeEstrelaBet(capture, "cs2"),
    ],
  ];
  for (const [provider, capture, parse] of cases) {
    const events = parse(capture);
    const publication = browser.httpPublication(
      provider,
      "cs2",
      "list",
      capture.capturedAt,
      capture.source,
      events,
    );
    const payload = browser.toWire(publication);
    assert.equal(payload.observations[0].source.url, "");
    assert.deepEqual(payload.events[0].provenance, {});
    assert.equal(
      server.fromWire(payload, provider).events.length,
      events.length,
    );
  }
  const bet365Capture = await fixture("bet365", "cs2.json");
  const bet365Payload = browser.toWire(
    browser.bet365Publication(bet365Capture),
  );
  assert.equal(
    server.fromWire(bet365Payload, "bet365").events.length,
    normalizers.normalizeBet365(bet365Capture).length,
  );
  const betanoRound = await fixture("betano", "cs2-round.json");
  const betanoPayload = browser.toWire(browser.betanoPublication(betanoRound));
  assert.equal(
    server.fromWire(betanoPayload, "betano").events.length,
    betanoPayload.events.length,
  );
});

test("detail captures keep provider IDs and markets across the browser/server boundary", async () => {
  const publicationBundle = await build({
    entryPoints: [join(root, "src", "publication.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "chrome120",
  });
  const browser = await import(
    `data:text/javascript;base64,${Buffer.from(publicationBundle.outputFiles[0].text).toString("base64")}`
  );
  const serverBundle = await build({
    entryPoints: [
      join(
        root,
        "..",
        "odds-service",
        "src",
        "modules",
        "runtime",
        "wire-payload.ts",
      ),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  const server = await import(
    `data:text/javascript;base64,${Buffer.from(serverBundle.outputFiles[0].text).toString("base64")}`
  );
  const structure = await fixture("superbet", "structure.json");
  const captures = [
    [
      "superbet",
      await fixture("superbet", "cs2-detail.json"),
      (c, id) => normalizers.normalizeSuperbetDetail(c, "cs2", id, structure),
    ],
    [
      "betano",
      await fixture("betano", "cs2-detail.json"),
      (c, id) => normalizers.normalizeBetanoDetail(c, "cs2", id),
    ],
    [
      "blaze",
      await fixture("blaze", "prematch.json"),
      (c, id) => normalizers.normalizeBlazeDetail(c, "cs2", id),
    ],
    [
      "estrelabet",
      await fixture("estrelabet", "cs2.json"),
      (c, id) => normalizers.normalizeEstrelaBetDetail(c, "cs2", id),
    ],
  ];
  for (const [provider, capture, parse] of captures) {
    const id =
      provider === "blaze"
        ? normalizers.normalizeBlaze(capture, "cs2")[0].eventId
        : capture.source.url.match(
            /(?:events\/|eventId=|\/)(\d+)(?:\/|\?|$)/,
          )?.[1];
    assert.ok(id, `${provider} fixture has no detail ID`);
    const event = parse(capture, id);
    assert.equal(event.eventId, id);
    assert.ok(event.markets.length > 0, `${provider} detail lost markets`);
    const pub =
      provider === "betano"
        ? browser.betanoDetailPublication(capture, "cs2", id)
        : browser.httpPublication(
            provider,
            "cs2",
            "detail",
            capture.capturedAt,
            capture.source,
            [event],
          );
    const wire = browser.toWire(pub);
    assert.equal(server.fromWire(wire, provider).events[0].eventId, id);
  }
  const bet365Files = ["list", "main", "map1", "map2"];
  const captures365 = await Promise.all(
    bet365Files.map((part) => fixture("bet365", `details/cs2-${part}.json`)),
  );
  const wire365 = browser.toWire(
    browser.bet365DetailPublication({
      eventId: "201241261",
      listing: captures365[0],
      captures: captures365.slice(1),
      coverage: "all_tabs",
    }),
  );
  assert.equal(server.fromWire(wire365, "bet365").events[0].markets.length, 30);
  assert.equal(wire365.observations.length, 3);
});

test("preview validates a real publication without writing or sending it", async () => {
  const publicationBundle = await build({
    entryPoints: [join(root, "src", "publication.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "chrome120",
  });
  const browser = await import(
    `data:text/javascript;base64,${Buffer.from(publicationBundle.outputFiles[0].text).toString("base64")}`
  );
  const publisherBundle = await build({
    entryPoints: [join(root, "src", "publisher.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "chrome120",
  });
  const publisher = await import(
    `data:text/javascript;base64,${Buffer.from(publisherBundle.outputFiles[0].text).toString("base64")}`
  );
  publisher.setPreviewMode(true);
  await publisher.queue(
    browser.bet365Publication(await fixture("bet365", "cs2.json")),
  );
  await publisher.flush();
  publisher.setPreviewMode(false);
});
