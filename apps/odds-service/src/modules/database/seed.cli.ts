import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { seedProviders } from "./seed.js";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
  await seedProviders(db);
  console.log("Providers seeded");
} finally {
  await db.$disconnect();
}
