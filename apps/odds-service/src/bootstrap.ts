import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module.js";
import { HttpErrorFilter } from "./shared/errors/http-error.filter.js";
export function configureHttp(app: INestApplication) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("cache-control", "no-store");
    if (req.method !== "GET") {
      res.status(405).json({ error: "Read-only API" });
      return;
    }
    next();
  });
  app.useGlobalFilters(new HttpErrorFilter());
  return app;
}
export async function createApp() {
  return configureHttp(
    await NestFactory.create(AppModule, { bodyParser: false }),
  );
}
