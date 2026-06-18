import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getOptionalEnv } from "@/lib/env";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5433/indonesia_payroll_agent?schema=public";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: getOptionalEnv("DATABASE_URL", DEFAULT_DATABASE_URL),
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
