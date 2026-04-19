-- Design System MCP — Initial Schema
-- Run this once against your Neon PostgreSQL database

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,               -- Supabase Auth user UUID
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_systems (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_systems_user_id ON design_systems(user_id);

CREATE TABLE IF NOT EXISTS design_system_data (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  design_system_id  TEXT NOT NULL REFERENCES design_systems(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  data_type         TEXT NOT NULL,   -- tokens | components | themes | icons | changelog | deprecations | style-guide
  data              JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (design_system_id, data_type)
);

CREATE INDEX IF NOT EXISTS idx_ds_data_design_system_id ON design_system_data(design_system_id);
CREATE INDEX IF NOT EXISTS idx_ds_data_user_id          ON design_system_data(user_id);

CREATE TABLE IF NOT EXISTS metrics (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id           TEXT NOT NULL,
  design_system_id  TEXT,
  event_type        TEXT NOT NULL,   -- request | cache_hit | routing | tool_call
  event_key         TEXT,            -- agent name or tool name
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_user_id ON metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_event_type ON metrics(event_type);
