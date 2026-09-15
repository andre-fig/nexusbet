import express from "express";
import { Readable } from "node:stream";

const app = express();
const port = Number(process.env.PORT || 3000);
const upstream = new URL(
  process.env.ODDS_SERVICE_URL || "http://odds-service.railway.internal:3650",
);

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api", async (request, response) => {
  if (request.method !== "GET") {
    response.status(405).json({ message: "Method not allowed" });
    return;
  }

  const controller = new AbortController();
  response.on("close", () => controller.abort());

  try {
    const url = new URL(request.url, upstream);
    const headers = { accept: request.headers.accept || "application/json" };
    if (request.headers["last-event-id"])
      headers["last-event-id"] = request.headers["last-event-id"];

    const result = await fetch(url, { headers, signal: controller.signal });
    response.status(result.status);
    for (const name of ["content-type", "cache-control", "etag"]) {
      const value = result.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.setHeader("x-accel-buffering", "no");
    if (!result.body) {
      response.end();
      return;
    }
    Readable.fromWeb(result.body).pipe(response);
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error("odds-service proxy failed", error);
    if (!response.headersSent)
      response.status(502).json({ message: "odds-service unavailable" });
    else response.end();
  }
});

app.use(express.static("dist", { index: false }));
app.get("*", (_request, response) => {
  response.sendFile("index.html", { root: "dist" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`odds-monitor listening on ${port}`);
});
