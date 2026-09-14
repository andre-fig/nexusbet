-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('scheduled', 'live', 'suspended', 'finished');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('matched', 'partial', 'low_confidence', 'manual', 'unmatched');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('open', 'resolved', 'ignored');

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "esport" TEXT NOT NULL,
    "tournament" TEXT NOT NULL,
    "team_a" TEXT NOT NULL,
    "team_b" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "EventStatus" NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "canonical_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "esport" TEXT NOT NULL,
    "raw_team_a" TEXT NOT NULL,
    "raw_team_b" TEXT NOT NULL,
    "normalized_team_a" TEXT NOT NULL,
    "normalized_team_b" TEXT NOT NULL,
    "raw_tournament" TEXT NOT NULL,
    "normalized_tournament" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "provider_status" TEXT NOT NULL,
    "in_play" BOOLEAN,
    "suspended" BOOLEAN,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "removed_at" TIMESTAMPTZ(3),
    "raw_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_event_id" UUID NOT NULL,
    "canonical_event_id" UUID,
    "confidence" DECIMAL(6,5) NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "reason" TEXT,
    "start_delta_seconds" INTEGER,
    "matched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_event_id" UUID NOT NULL,
    "canonical_event_id" UUID,
    "status" "MatchStatus" NOT NULL,
    "confidence" DECIMAL(6,5) NOT NULL,
    "reason" TEXT,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_event_id" UUID NOT NULL,
    "provider_market_id" TEXT NOT NULL,
    "raw_market_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "map_number" INTEGER,
    "line" DECIMAL(24,12),
    "period" TEXT,
    "suspended" BOOLEAN,
    "in_play" BOOLEAN,
    "raw_data" JSONB NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "market_id" UUID NOT NULL,
    "provider_selection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "side" TEXT,
    "line" DECIMAL(24,12),
    "suspended" BOOLEAN,
    "raw_data" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odds_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "selection_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "source_scope" TEXT NOT NULL,
    "odds" DECIMAL(24,12),
    "line" DECIMAL(24,12),
    "map_number" INTEGER,
    "suspended" BOOLEAN,
    "in_play" BOOLEAN,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odds_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dedupe_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "provider_id" UUID,
    "canonical_event_id" UUID,
    "provider_event_id" UUID,
    "market_id" UUID,
    "selection_id" UUID,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "status" "IssueStatus" NOT NULL DEFAULT 'open',
    "detected_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "issue_id" UUID NOT NULL,
    "status" "IssueStatus" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "issue_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_scopes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "provider_id" UUID NOT NULL,
    "esport" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3),
    "events" JSONB NOT NULL,
    "observations" JSONB NOT NULL,

    CONSTRAINT "feed_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "hash" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_checkpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "legacy_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "providers_slug_key" ON "providers"("slug");

-- CreateIndex
CREATE INDEX "canonical_events_starts_at_idx" ON "canonical_events"("starts_at");

-- CreateIndex
CREATE INDEX "canonical_events_status_idx" ON "canonical_events"("status");

-- CreateIndex
CREATE INDEX "provider_events_provider_id_starts_at_idx" ON "provider_events"("provider_id", "starts_at");

-- CreateIndex
CREATE INDEX "provider_events_last_seen_at_idx" ON "provider_events"("last_seen_at");

-- CreateIndex
CREATE INDEX "provider_events_provider_status_idx" ON "provider_events"("provider_status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_events_provider_id_provider_event_id_key" ON "provider_events"("provider_id", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_matches_provider_event_id_key" ON "event_matches"("provider_event_id");

-- CreateIndex
CREATE INDEX "event_matches_canonical_event_id_idx" ON "event_matches"("canonical_event_id");

-- CreateIndex
CREATE INDEX "event_matches_status_idx" ON "event_matches"("status");

-- CreateIndex
CREATE INDEX "match_decisions_provider_event_id_detected_at_idx" ON "match_decisions"("provider_event_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "markets_category_map_number_idx" ON "markets"("category", "map_number");

-- CreateIndex
CREATE UNIQUE INDEX "markets_provider_event_id_provider_market_id_key" ON "markets"("provider_event_id", "provider_market_id");

-- CreateIndex
CREATE UNIQUE INDEX "selections_market_id_provider_selection_id_key" ON "selections"("market_id", "provider_selection_id");

-- CreateIndex
CREATE INDEX "odds_snapshots_selection_id_fetched_at_created_at_idx" ON "odds_snapshots"("selection_id", "fetched_at" DESC, "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "odds_snapshots_publication_id_selection_id_source_scope_fet_key" ON "odds_snapshots"("publication_id", "selection_id", "source_scope", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_issues_dedupe_key_key" ON "data_issues"("dedupe_key");

-- CreateIndex
CREATE INDEX "data_issues_status_severity_detected_at_idx" ON "data_issues"("status", "severity", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "data_issues_provider_id_idx" ON "data_issues"("provider_id");

-- CreateIndex
CREATE INDEX "data_issues_canonical_event_id_idx" ON "data_issues"("canonical_event_id");

-- CreateIndex
CREATE INDEX "data_issues_provider_event_id_idx" ON "data_issues"("provider_event_id");

-- CreateIndex
CREATE INDEX "issue_transitions_issue_id_at_idx" ON "issue_transitions"("issue_id", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "feed_scopes_name_key" ON "feed_scopes"("name");

-- CreateIndex
CREATE INDEX "feed_scopes_provider_id_kind_idx" ON "feed_scopes"("provider_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "publications_scope_id_fetched_at_key" ON "publications"("scope_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_checkpoints_key_key" ON "legacy_checkpoints"("key");

-- AddForeignKey
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_matches" ADD CONSTRAINT "event_matches_provider_event_id_fkey" FOREIGN KEY ("provider_event_id") REFERENCES "provider_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_matches" ADD CONSTRAINT "event_matches_canonical_event_id_fkey" FOREIGN KEY ("canonical_event_id") REFERENCES "canonical_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_provider_event_id_fkey" FOREIGN KEY ("provider_event_id") REFERENCES "provider_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_canonical_event_id_fkey" FOREIGN KEY ("canonical_event_id") REFERENCES "canonical_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_provider_event_id_fkey" FOREIGN KEY ("provider_event_id") REFERENCES "provider_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_issues" ADD CONSTRAINT "data_issues_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_issues" ADD CONSTRAINT "data_issues_canonical_event_id_fkey" FOREIGN KEY ("canonical_event_id") REFERENCES "canonical_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_issues" ADD CONSTRAINT "data_issues_provider_event_id_fkey" FOREIGN KEY ("provider_event_id") REFERENCES "provider_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_issues" ADD CONSTRAINT "data_issues_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_issues" ADD CONSTRAINT "data_issues_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_transitions" ADD CONSTRAINT "issue_transitions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "data_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_scopes" ADD CONSTRAINT "feed_scopes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "feed_scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Observation history must not be edited or deleted through application writes.
CREATE FUNCTION protect_odds_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'odds_snapshots is append-only'; END $$;
CREATE TRIGGER odds_snapshots_immutable BEFORE UPDATE OR DELETE ON odds_snapshots
FOR EACH ROW EXECUTE FUNCTION protect_odds_history();
ALTER TABLE odds_snapshots ADD CONSTRAINT valid_odds CHECK (odds IS NULL OR odds > 1);
ALTER TABLE markets ADD CONSTRAINT positive_map CHECK (map_number IS NULL OR map_number > 0);
ALTER TABLE event_matches ADD CONSTRAINT match_link_consistency CHECK ((status = 'unmatched' AND canonical_event_id IS NULL) OR (status <> 'unmatched' AND canonical_event_id IS NOT NULL));
ALTER TABLE event_matches ADD CONSTRAINT confidence_range CHECK (confidence >= 0 AND confidence <= 1);
