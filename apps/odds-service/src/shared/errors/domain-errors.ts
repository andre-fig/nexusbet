export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Record<string, unknown> = { error: message },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class StaleDataError extends ServiceError {
  constructor(message: string, fields: Record<string, unknown> = {}) {
    super(message, 503, { error: message, ...fields });
  }
}
export class ProviderUnavailableError extends ServiceError {
  constructor(provider: string, cause?: unknown) {
    super(provider + " unavailable", 503, undefined, { cause });
  }
}
export class ProviderParseError extends ServiceError {
  constructor(provider: string, cause: unknown) {
    super(provider + " feed rejected", 502, undefined, { cause });
  }
}
export class ProviderTransportError extends ServiceError {
  constructor(provider: string, cause: unknown) {
    super(provider + " transport failed", 503, undefined, { cause });
  }
}
