import type { PrismaClient } from "../../generated/prisma/client.js";
export async function seedProviders(db: PrismaClient) {
  for (const [slug, name] of [
    ["bet365", "Bet365"],
    ["betano", "Betano"],
    ["superbet", "Superbet"],
    ["blaze", "Blaze"],
    ["estrelabet", "EstrelaBet"],
  ])
    await db.provider.upsert({
      where: { slug },
      create: { slug, name },
      update: { name },
    });
}
