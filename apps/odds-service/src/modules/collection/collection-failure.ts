import {
  ProviderTransportError,
  ProviderUnavailableError,
} from "../../shared/errors/domain-errors.js";
/** Protocol/parse rejection does not by itself invalidate an otherwise usable browser session. */
export function isTransportFailure(error: unknown): boolean {
  if (
    error instanceof ProviderTransportError ||
    error instanceof ProviderUnavailableError
  )
    return true;
  return (
    error instanceof Error &&
    /^(CDP |Chrome |WebSocket |Feed HTTP |Betano HTTP )/.test(error.message)
  );
}
