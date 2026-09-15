CREATE TABLE ingestion_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 provider TEXT NOT NULL,
 collection_run_id TEXT NOT NULL,
 hash TEXT NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ingestion_runs_provider_collection_run_id_key UNIQUE(provider, collection_run_id)
);
