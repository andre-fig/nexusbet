import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module.js";
import { AppConfiguration } from "../../config/configuration.js";
import { CollectionService } from "./collection.service.js";
// CLI owns the loop; never also start an application-level polling scheduler.
process.env.POLLING_ENABLED = "0";
process.env.COLLECTION_ENABLED = "false";
if (process.argv.includes("--save-raw"))
  process.env.RAW_CAPTURE_ENABLED = "true";
const app = await NestFactory.createApplicationContext(AppModule);
const collection = app.get(CollectionService),
  c = app.get(AppConfiguration).settings;
const names = [
  process.argv.includes("--estrelabet")
    ? "estrelabet"
    : process.argv.includes("--blaze")
      ? "blaze"
      : process.argv.includes("--superbet")
        ? "superbet"
        : process.argv.includes("--betano")
          ? "betano"
          : "bet365",
];
const options = {
  esports: c.esports,
  existing: process.argv.includes("--existing"),
  reuseProfile: process.argv.includes("--reuse-profile"),
  mainOnly: process.argv.includes("--main-only"),
  details: process.argv.includes("--detail"),
};
const abort = new AbortController();
const stop = () => abort.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  if (process.argv.includes("--loop")) {
    const results = await collection.runLoop(names, options, abort.signal);
    if (results.some((ok) => !ok)) process.exitCode = 1;
  } else {
    const results = await collection.collectCycle(names, options);
    if (results.some((r) => r.status !== "ok")) process.exitCode = 1;
  }
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await app.close();
}
