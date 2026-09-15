import { json } from "express";
import { AppConfiguration } from "./config/configuration.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module.js";
import { HttpErrorFilter } from "./shared/errors/http-error.filter.js";
export function configureHttp(app: INestApplication) {
  const origin = app.get(AppConfiguration).settings.monitorOrigin;
  if (origin)
    app.enableCors({
      origin: origin.split(",").map((x) => x.trim()),
      methods: ["GET"],
      credentials: false,
    });
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("cache-control", "no-store");
    if (
      req.method !== "GET" &&
      !(
        req.method === "POST" &&
        /^\/internal\/(ingestion\/(bet365|betano|superbet|blaze|estrelabet)|agents\/heartbeat)\/?$/.test(
          req.path,
        )
      )
    ) {
      res.status(405).json({ error: "Read-only API" });
      return;
    }
    next();
  });
  app.use("/internal", json({ limit: "8mb", strict: true }));
  app.useGlobalFilters(new HttpErrorFilter());
  return app;
}
export async function createApp() {
  return configureHttp(
    await NestFactory.create(AppModule, { bodyParser: false }),
  );
}
