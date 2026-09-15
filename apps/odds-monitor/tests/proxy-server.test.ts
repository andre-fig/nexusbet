import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function withTimeout<T>(promise: Promise<T>, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error(message())), 5000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test("closing an SSE client does not crash the odds-monitor proxy", async () => {
  let upstreamClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    upstreamClosed = resolve;
  });
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("event: ready\ndata: {}\n\n");
    response.once("close", upstreamClosed);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");

  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const probeAddress = probe.address();
  assert.ok(probeAddress && typeof probeAddress !== "string");
  const monitorPort = probeAddress.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    cwd: dirname(serverPath),
    env: {
      ...process.env,
      PORT: String(monitorPort),
      ODDS_SERVICE_URL: `http://127.0.0.1:${address.port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const ready = (chunk: Buffer) => {
          if (chunk.toString().includes("odds-monitor listening")) resolve();
        };
        child.stdout.on("data", ready);
        child.once("exit", (code) =>
          reject(Error(`proxy exited during startup (${code}): ${output}`)),
        );
      }),
      () => `proxy startup timed out: ${output}`,
    );
    const controller = new AbortController();
    const stream = await fetch(
      `http://127.0.0.1:${monitorPort}/api/monitor/stream`,
      { signal: controller.signal },
    );
    assert.equal(stream.status, 200);
    const first = await stream.body?.getReader().read();
    assert.match(new TextDecoder().decode(first?.value), /event: ready/);
    controller.abort();
    await withTimeout(closed, () => `upstream did not close: ${output}`);
    assert.equal(child.exitCode, null, output);
    const health = await fetch(`http://127.0.0.1:${monitorPort}/healthz`);
    assert.equal(health.status, 200, output);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
