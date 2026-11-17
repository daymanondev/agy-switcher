/**
 * Domain errors for agy-switcher
 */

export class AgySwitcherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class KeychainError extends AgySwitcherError {
  public readonly exitCode?: number;
  public readonly stderr?: string;
  public readonly command?: string;

  constructor(
    message: string,
    exitCode?: number,
    stderr?: string,
    command?: string
  ) {
    super(message);
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.command = command;
  }
}

export class KeychainItemNotFoundError extends KeychainError {
  constructor(service: string, account: string) {
    super(`Keychain item not found for service="${service}", account="${account}"`, 44);
  }
}

export class TokenParseError extends AgySwitcherError {
  public readonly rawPayload?: string;

  constructor(message: string, rawPayload?: string) {
    super(message);
    this.rawPayload = rawPayload;
  }
}

export class TokenRefreshError extends AgySwitcherError {
  public readonly httpStatus?: number;
  public readonly errorResponse?: unknown;

  constructor(
    message: string,
    httpStatus?: number,
    errorResponse?: unknown
  ) {
    super(message);
    this.httpStatus = httpStatus;
    this.errorResponse = errorResponse;
  }
}

export class ProfileNotFoundError extends AgySwitcherError {
  public readonly alias: string;

  constructor(alias: string) {
    super(`Profile '${alias}' not found in Keychain`);
    this.alias = alias;
  }
}

export class AuthTokenExpiredError extends AgySwitcherError {
  public readonly httpStatus = 401;

  constructor(message = 'Access token expired or unauthorized') {
    super(message);
  }
}

export class SubscriptionRequiredError extends AgySwitcherError {
  public readonly httpStatus = 403;
  public readonly reason: string;
  public readonly project?: string;

  constructor(message: string, project?: string, reason = 'SUBSCRIPTION_REQUIRED') {
    super(message);
    this.project = project;
    this.reason = reason;
  }
}

export class RateLimitExceededError extends AgySwitcherError {
  public readonly httpStatus = 429;
  public readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ServiceUnavailableError extends AgySwitcherError {
  public readonly httpStatus: number;

  constructor(message: string, httpStatus = 503) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

export class NetworkOfflineError extends AgySwitcherError {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class CloudCodeApiError extends AgySwitcherError {
  public readonly httpStatus: number;
  public readonly responseBody?: unknown;

  constructor(message: string, httpStatus: number, responseBody?: unknown) {
    super(message);
    this.httpStatus = httpStatus;
    this.responseBody = responseBody;
  }
}

