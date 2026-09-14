import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ServiceError } from "./domain-errors.js";
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("Collection");
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof ServiceError) {
      response.status(error.status).json(error.payload);
      return;
    }
    if (error instanceof HttpException) {
      response
        .status(error.getStatus())
        .json(
          error.getStatus() === 404
            ? { error: "Not found" }
            : error.getResponse(),
        );
      return;
    }
    this.logger.error("Unhandled backend error");
    response.status(500).json({ error: "Internal service error" });
  }
}
