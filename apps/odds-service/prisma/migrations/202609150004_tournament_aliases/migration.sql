CREATE TABLE "tournament_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "esport" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tournament_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tournament_aliases_esport_alias_key" ON "tournament_aliases"("esport", "alias");
