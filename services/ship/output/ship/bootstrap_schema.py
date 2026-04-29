"""Database bootstrap for the ship-mode conversation service."""

from __future__ import annotations

import asyncpg


SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS investigator;

CREATE TABLE IF NOT EXISTS investigator.ship_conversations (
    conversation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title             text,
    status            text NOT NULL DEFAULT 'active',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investigator.ship_messages (
    message_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   uuid NOT NULL REFERENCES investigator.ship_conversations(conversation_id) ON DELETE CASCADE,
    role              text NOT NULL CHECK (role IN ('user','assistant')),
    content           jsonb NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ship_messages_conv_time
    ON investigator.ship_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS investigator.ship_recipe_runs (
    run_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   uuid NOT NULL REFERENCES investigator.ship_conversations(conversation_id) ON DELETE CASCADE,
    message_id        uuid NOT NULL REFERENCES investigator.ship_messages(message_id) ON DELETE CASCADE,
    based_on_run_id   uuid REFERENCES investigator.ship_recipe_runs(run_id) ON DELETE SET NULL,
    recipe_id         text NOT NULL,
    params            jsonb,
    findings          jsonb,
    sql_log           jsonb,
    summary           jsonb,
    verification      jsonb,
    latency_ms        int,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ship_recipe_runs_conv_time
    ON investigator.ship_recipe_runs(conversation_id, created_at);

ALTER TABLE investigator.ship_recipe_runs
    ADD COLUMN IF NOT EXISTS based_on_run_id uuid REFERENCES investigator.ship_recipe_runs(run_id) ON DELETE SET NULL;

ALTER TABLE investigator.ship_recipe_runs
    ADD COLUMN IF NOT EXISTS is_derived boolean NOT NULL DEFAULT false;

ALTER TABLE investigator.ship_recipe_runs
    ADD COLUMN IF NOT EXISTS derived_op jsonb;

ALTER TABLE investigator.ship_recipe_runs
    ADD COLUMN IF NOT EXISTS op_hash text;

ALTER TABLE investigator.ship_recipe_runs
    ADD COLUMN IF NOT EXISTS source_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS ix_ship_recipe_runs_derived_cache
    ON investigator.ship_recipe_runs(conversation_id, op_hash)
    WHERE is_derived;

CREATE TABLE IF NOT EXISTS investigator.ship_conversation_memory (
    conversation_id      uuid NOT NULL REFERENCES investigator.ship_conversations(conversation_id) ON DELETE CASCADE,
    run_id               uuid NOT NULL REFERENCES investigator.ship_recipe_runs(run_id) ON DELETE CASCADE,
    pinned               boolean NOT NULL DEFAULT false,
    forgotten            boolean NOT NULL DEFAULT false,
    description          text NOT NULL,
    params_summary       text NOT NULL DEFAULT '',
    derived_from_run_id  uuid REFERENCES investigator.ship_recipe_runs(run_id) ON DELETE SET NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, run_id)
);

CREATE INDEX IF NOT EXISTS ix_ship_conversation_memory_conv_recent
    ON investigator.ship_conversation_memory(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS investigator.ship_analytical_audit (
    id               uuid PRIMARY KEY,
    conversation_id  uuid NOT NULL,
    turn_id          uuid NOT NULL,
    user_question    text NOT NULL,
    plan_json        jsonb NOT NULL,
    sql_text         text NOT NULL DEFAULT '',
    schema_hash      text NOT NULL,
    lexicon_version  text NOT NULL,
    sandbox_result   text NOT NULL,
    row_count        integer,
    timing_ms        integer,
    verifier_status  text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytical_reader') THEN
        CREATE ROLE analytical_reader;
    END IF;
END
$$;
"""


async def bootstrap_schema(pool: asyncpg.Pool) -> None:
    """Create the service-owned investigator.ship_* tables if missing."""
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
