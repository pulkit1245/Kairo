import { PrismaClient } from '@prisma/client';

// one client for the whole process. prisma keeps its own connection pool,
// creating a new client per request would exhaust postgres connections fast
export const prisma = new PrismaClient();
