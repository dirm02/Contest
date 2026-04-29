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
"""


async def bootstrap_schema(pool: asyncpg.Pool) -> None:
    """Create the service-owned investigator.ship_* tables if missing."""
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
