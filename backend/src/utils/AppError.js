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

// One readable line for logs. Prisma's messages start with a blank line and a
// call site ("Invalid `prisma.x()` invocation:"), so skip those.
export function shortError(err) {
  const lines = errorMessage(err)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Invalid `prisma\./.test(l));
  const code = err?.code ? `${err.code}: ` : '';
  return `${code}${lines[0] ?? 'unknown error'}`;
}

// Prisma's "can't reach / lost the database" errors
const DB_DOWN_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);
export function isDatabaseDown(err) {
  return DB_DOWN_CODES.has(err?.code) || err?.name === 'PrismaClientInitializationError';
}
