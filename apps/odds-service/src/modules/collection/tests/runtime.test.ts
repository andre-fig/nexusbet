import { existsSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

const shell = existsSync("/opt/homebrew/bin/bash")
  ? "/opt/homebrew/bin/bash"
  : "bash";

const supportedShell =
  spawnSync(shell, ["-c", 'test "${BASH_VERSINFO[0]}" -ge 5']).status === 0;

async function harness(crashDisplay = false, browserRuntime = "local-cdp") {
  const dir = await mkdtemp(join(tmpdir(), "odds-runtime-"));
  const log = join(dir, "order");
  const executable = async (name: string, body: string) => {
    await writeFile(join(dir, name), body, { mode: 0o755 });
  };
  await executable("id", "#!/bin/sh\necho 1000\n");
  await executable("xdpyinfo", "#!/bin/sh\nexit 0\n");
  await executable(
    "Xvfb",
    `#!/usr/bin/env node
const fs = require('node:fs');
const log = (s) => fs.appendFileSync(process.env.RUNTIME_TEST_LOG, s+'\\n');
log('display-start');
setInterval(()=>{}, 1000);
process.on('SIGTERM',()=>{log('display-stop');process.exit(0)});
${crashDisplay ? "setTimeout(()=>{log('display-crash');process.exit(1)},500);" : ""}
`,
  );
  await executable(
    "app",
    `#!/usr/bin/env node
const fs = require('node:fs');
const log = (s) => fs.appendFileSync(process.env.RUNTIME_TEST_LOG, s+'\\n');
log('app-start');
setInterval(()=>{}, 1000);
process.once('SIGTERM',()=>{
 log('draining');
 setTimeout(()=>{log('commit-and-browser-close');process.exit(0)},150);
});
// Readiness must follow signal registration, otherwise the test races SIGTERM.
console.log('APP_READY');
`,
  );
  const child = spawn(
    shell,
    [resolve("runtime/entrypoint.sh"), join(dir, "app")],
    {
      env: {
        ...process.env,
        PATH: dir + ":" + process.env.PATH,
        BROWSER_MODE: "headed",
        BROWSER_RUNTIME: browserRuntime,
        RUNTIME_TEST_LOG: log,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exit = once(child, "exit");
  let output = "";
  const ready = new Promise<void>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("APP_READY")) resolve();
    });
  });
  return {
    child,
    exit,
    ready,
    log,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test(
  "runtime SIGTERM drains application before closing display",
  { timeout: 10000, skip: !supportedShell },
  async () => {
    const run = await harness();
    try {
      await run.ready;
      run.child.kill("SIGTERM");
      assert.equal((await run.exit)[0], 0);
      const order = (await readFile(run.log, "utf8")).trim().split("\n");
      assert.ok(
        order.indexOf("commit-and-browser-close") > order.indexOf("draining"),
      );
      assert.ok(
        order.indexOf("display-stop") >
          order.indexOf("commit-and-browser-close"),
      );
    } finally {
      await run.cleanup();
    }
  },
);

test(
  "runtime display failure stops application and reports failure",
  { timeout: 10000, skip: !supportedShell },
  async () => {
    const run = await harness(true);
    try {
      assert.equal((await run.exit)[0], 1);
      assert.match(
        await readFile(run.log, "utf8"),
        /draining\ncommit-and-browser-close/,
      );
    } finally {
      await run.cleanup();
    }
  },
);

test(
  "disabled browser runtime does not start Xvfb and still drains the application",
  { timeout: 10000, skip: !supportedShell },
  async () => {
    const run = await harness(false, "disabled");
    try {
      await run.ready;
      run.child.kill("SIGTERM");
      assert.equal((await run.exit)[0], 0);
      const order = (await readFile(run.log, "utf8")).trim().split("\n");
      assert.deepEqual(order, [
        "app-start",
        "draining",
        "commit-and-browser-close",
      ]);
    } finally {
      await run.cleanup();
    }
  },
);

test("production runtime rejects headless instead of silently falling back", async () => {
  const child = spawn(shell, [resolve("runtime/entrypoint.sh"), "true"], {
    env: {
      ...process.env,
      BROWSER_MODE: "headless",
      BROWSER_RUNTIME: "local-cdp",
    },
    stdio: "ignore",
  });
  assert.equal((await once(child, "exit"))[0], 64);
});
