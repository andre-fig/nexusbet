import { createApp } from "./bootstrap.js";
import { AppConfiguration } from "./config/configuration.js";
const app = await createApp();
app.enableShutdownHooks();
const { port, host } = app.get(AppConfiguration).settings;
await app.listen(port, host);
