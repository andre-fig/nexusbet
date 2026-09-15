import "reflect-metadata";
import { existsSync, unlinkSync } from "node:fs";
if (process.env.ODDS_RUNTIME && process.env.ODDS_RUNTIME !== "collector-agent")
  throw Error("Use server entrypoint");
process.env.ODDS_RUNTIME = "collector-agent";
const { Module } = await import("@nestjs/common");
const { NestFactory } = await import("@nestjs/core");
const { CollectionModule } =
  await import("./modules/collection/collection.module.js");
const { runtimeSettings } =
  await import("./modules/runtime/runtime-settings.js");
runtimeSettings("collector-agent");
@Module({ imports: [CollectionModule] })
class CollectorAgentModule {}
const app = await NestFactory.createApplicationContext(CollectorAgentModule);
app.enableShutdownHooks();
const stopFile = process.env.ODDS_AGENT_STOP_FILE;
if (stopFile) {
  let stopping = false;
  const timer = setInterval(() => {
    if (stopping || !existsSync(stopFile)) return;
    stopping = true;
    clearInterval(timer);
    try {
      unlinkSync(stopFile);
    } catch {
      // The supervisor owns this marker; shutdown still proceeds.
    }
    void app.close().then(() => {
      process.exitCode = 0;
    });
  }, 1000);
  timer.unref();
}
