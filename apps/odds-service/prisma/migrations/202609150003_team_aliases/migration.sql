CREATE TABLE "team_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "esport" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_aliases_esport_alias_key" ON "team_aliases"("esport", "alias");
