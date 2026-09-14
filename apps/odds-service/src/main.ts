import { createApp } from "./bootstrap.js";
import { AppConfiguration } from "./config/configuration.js";
const app = await createApp();
app.enableShutdownHooks();
await app.listen(app.get(AppConfiguration).settings.port, "127.0.0.1");
