-- =====================================================
-- Orange Apartment — Schema v3 Migration
-- =====================================================
-- Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)
-- AFTER supabase-migration-2.sql. Safe to re-run: idempotent.
--
-- This migration:
--   1. Adds an optional `units` column to expenses so utility bills can
--      record actual consumption alongside cost — kWh for electricity,
--      cubic meters for water. The dashboard's Utilities insight uses it
--      to chart real usage and compute the effective ₱/kWh and ₱/m³,
--      which separates "we used more" from "the rate went up".
--
-- The portal works without this migration: the usage field simply stays
-- hidden and utility insights fall back to cost-only trends.
-- =====================================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS units numeric;

DO $$ BEGIN
  ALTER TABLE expenses ADD CONSTRAINT expenses_units_check
    CHECK (units IS NULL OR units >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
