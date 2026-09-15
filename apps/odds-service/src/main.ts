import "reflect-metadata";
if (process.env.ODDS_RUNTIME && process.env.ODDS_RUNTIME !== "server")
  throw Error("Use collector-agent entrypoint");
process.env.ODDS_RUNTIME = "server";
const { createApp } = await import("./bootstrap.js");
const { AppConfiguration } = await import("./config/configuration.js");
const { runtimeSettings } =
  await import("./modules/runtime/runtime-settings.js");
runtimeSettings("server");
const app = await createApp();
if (app.get(AppConfiguration).settings.persistenceMode !== "postgres") {
  await app.close();
  throw Error("Server requires PostgreSQL");
}
app.enableShutdownHooks();
const { port, host } = app.get(AppConfiguration).settings;
await app.listen(port, host);
