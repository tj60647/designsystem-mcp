-- Design System MCP — Migration 002
-- Fix: include user_id in the design_system_data UNIQUE constraint so that
-- the UPSERT in setScopedData cannot overwrite a different user's data for
-- the same design_system_id + data_type combination.
--
-- The original constraint was: UNIQUE(design_system_id, data_type)
-- The corrected constraint is: UNIQUE(design_system_id, user_id, data_type)

ALTER TABLE design_system_data
  DROP CONSTRAINT IF EXISTS design_system_data_design_system_id_data_type_key;

ALTER TABLE design_system_data
  ADD CONSTRAINT design_system_data_design_system_id_user_id_data_type_key
  UNIQUE (design_system_id, user_id, data_type);
