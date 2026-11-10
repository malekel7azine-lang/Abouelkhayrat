export type ProviderFailureKind = "unauthorized" | "exhausted" | "temporary" | "parameter" | "fatal";

export class ProviderError extends Error {
  constructor(message: string, readonly kind: ProviderFailureKind, readonly status?: number, readonly providerCode?: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export function classifyProviderFailure(status: number, code: string | number | undefined, message: string): ProviderError {
  const normalized = String(code ?? status).toLowerCase();
  const detail = message.toLowerCase();
  if (status === 401 || status === 403 || normalized === "401" || normalized === "403" ||
      /unauthori[sz]ed|invalid_api_key|authentication|invalid key/.test(normalized + " " + detail)) {
    return new ProviderError("Provider authentication failed", "unauthorized", status, normalized);
  }
  if (status === 402 || normalized === "402" || /insufficient|balance|credit|quota_exceeded/.test(normalized + " " + detail)) {
    return new ProviderError("Provider credits exhausted", "exhausted", status, normalized);
  }
  if (status === 429 || status >= 500 || /rate_limit|too_many_requests|temporar|server_error|overloaded/.test(normalized + " " + detail) ||
      ["429", "455", "500", "501", "503", "504"].includes(normalized)) {
    return new ProviderError("Provider temporarily unavailable", "temporary", status, normalized);
  }
  if (status === 400 || status === 404 || status === 422 || /invalid_request|validation_error|bad_request|unprocessable/.test(normalized + " " + detail) ||
      ["400", "404", "422"].includes(normalized)) {
    return new ProviderError("Provider rejected request parameters", "parameter", status, normalized);
  }
  return new ProviderError("Provider request failed", "fatal", status, normalized);
}
