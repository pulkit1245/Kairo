// thrown for anything we expect to go wrong (bad input, repo not found, unsupported stack...)
// the message is safe to show on the dashboard
export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(what) {
    super(`${what} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export function errorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
