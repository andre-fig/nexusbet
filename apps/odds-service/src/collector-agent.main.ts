import "reflect-metadata";
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
