-- =====================================================
-- Orange Apartment — Schema v2 Migration
-- =====================================================
-- Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)
-- AFTER supabase-migration.sql, BEFORE deploying the updated portal.
-- Safe to re-run: every statement is idempotent.
--
-- This migration:
--   1. Adds billing-model columns to tenants
--      (per-head all-inclusive flat rate vs itemized rent+utilities)
--   2. Adds an optional floor/group label to tenants
--   3. Enforces access-code uniqueness among active tenants
--   4. Creates an expenses table (admin-only) for utility/expense
--      tracking so all-inclusive margins are visible
--   5. Replaces login_tenant so only FAILED attempts are rate-limited
--      (legit tenants with saved codes can no longer lock themselves out),
--      and adds per-IP + global failure caps so varying the guessed code
--      no longer evades throttling
--   6. Restricts read_setting to an allowlist of tenant-visible keys
--   7. Adds a rev counter to tenants for optimistic concurrency
--      (two admin tabs can no longer silently overwrite each other's bills)
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. Billing model columns
-- ─────────────────────────────────────────────────────
-- 'itemized'  = rent + utilities billed as separate line items (default)
-- 'inclusive' = one flat monthly rate, utilities shouldered by management

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'itemized';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS flat_rate numeric;

DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_billing_model_check
    CHECK (billing_model IN ('itemized','inclusive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_flat_rate_check
    CHECK (flat_rate IS NULL OR flat_rate >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────
-- 2. Floor / group label (optional, free text: "3rd Floor", "Tower B")
-- ─────────────────────────────────────────────────────

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS floor text NOT NULL DEFAULT '';

-- ─────────────────────────────────────────────────────
-- 3. Access-code uniqueness (active tenants only)
-- ─────────────────────────────────────────────────────
-- Partial index: archived tenants keep their historical code without
-- blocking its reuse. Until now uniqueness was only checked client-side;
-- a duplicate code would make login_tenant return an arbitrary tenant.
--
-- NOTE: if this statement fails with "could not create unique index",
-- two ACTIVE tenants share a code. Find them with:
--   SELECT code, count(*) FROM tenants
--   WHERE archived_at IS NULL GROUP BY code HAVING count(*) > 1;
-- regenerate one of the codes in the portal, then re-run this file.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_code_active
  ON tenants (code) WHERE archived_at IS NULL;

-- ─────────────────────────────────────────────────────
-- 4. Expenses table (admin-only)
-- ─────────────────────────────────────────────────────
-- Records what the building actually spends (electricity, water, repairs…)
-- so collected-vs-spent margins are visible — essential once any floor is
-- on an all-inclusive rate and management shoulders the utilities.

CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY,                        -- client-generated uuid (same pattern as tenants)
  expense_date date NOT NULL,
  category text NOT NULL DEFAULT 'other',     -- electricity | water | internet | maintenance | taxes | other
  amount numeric NOT NULL CHECK (amount >= 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date DESC);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Admin (authenticated) full CRUD; anon has NO access (no policy = denied).
DO $$ BEGIN
  CREATE POLICY "Admin full access on expenses"
    ON expenses
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────
-- 5. login_tenant v2 — smarter rate limiting
-- ─────────────────────────────────────────────────────
-- Three changes over v1:
--   a) Only FAILED attempts count. v1 recorded every call, so a tenant with
--      a remembered code who refreshed the portal 6 times in 15 minutes
--      locked themselves out.
--   b) Per-IP cap. v1's limit was keyed on the guessed code, so an attacker
--      who varied the code on every request was never throttled at all.
--      PostgREST exposes the caller's address in the request headers; 20
--      failures per IP per 15 minutes stops enumeration cold.
--   c) Global circuit breaker. If failures across ALL sources exceed 300 in
--      15 minutes (a distributed attack), tenant login pauses entirely.
--      Admin login is unaffected (it uses Supabase auth, not this RPC).

ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS ip text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time
  ON login_attempts (ip, attempted_at DESC);

CREATE OR REPLACE FUNCTION login_tenant(access_code text)
RETURNS SETOF tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  xff_parts text[];
  caller_ip text;
  code_failures int;
  ip_failures int;
  total_failures int;
  matched tenants%ROWTYPE;
BEGIN
  -- Opportunistic cleanup: drop attempts older than 1 hour so the table
  -- stays small without requiring pg_cron.
  DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 hour';

  -- A CORRECT code always logs in — rate limits gate only the failure path.
  -- Failing open for valid codes means an attacker (or a flood of failures,
  -- or a spoofed-IP campaign) can never lock legitimate tenants out of
  -- their own portal; throttling wrong guesses is all the limits are for.
  SELECT * INTO matched
  FROM tenants
  WHERE tenants.code = access_code
    AND tenants.archived_at IS NULL
  LIMIT 1;

  IF matched.id IS NOT NULL THEN
    RETURN NEXT matched;
    RETURN;
  END IF;

  -- Caller IP: LAST X-Forwarded-For hop. Each proxy appends the address it
  -- saw, so the last entry comes from Supabase's own edge; the first entry
  -- is client-supplied and trivially spoofable. Best-effort either way.
  xff_parts := string_to_array(
    COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',');
  caller_ip := COALESCE(trim(xff_parts[array_length(xff_parts, 1)]), '');

  SELECT
    count(*) FILTER (WHERE code = access_code),
    count(*) FILTER (WHERE ip = caller_ip AND caller_ip <> ''),
    count(*)
  INTO code_failures, ip_failures, total_failures
  FROM login_attempts
  WHERE attempted_at > now() - interval '15 minutes';

  -- Block BEFORE recording so attackers cannot extend their own lockout.
  -- Per-code stops targeted guessing, per-IP stops single-host enumeration,
  -- and the global window bounds table growth under a distributed attack.
  IF code_failures >= 5 OR ip_failures >= 20 OR total_failures >= 300 THEN
    RAISE EXCEPTION 'Too many login attempts. Please wait and try again.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Record only failures.
  INSERT INTO login_attempts (code, ip) VALUES (access_code, caller_ip);
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION login_tenant(text) TO anon;

-- ─────────────────────────────────────────────────────
-- 6. read_setting v2 — allowlist tenant-visible keys
-- ─────────────────────────────────────────────────────
-- v1 let the anon role read ANY settings row. The settings table only
-- holds tenant-facing content today, but an allowlist means a future
-- admin-only setting can never leak through this function by accident.

CREATE OR REPLACE FUNCTION read_setting(setting_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result text;
BEGIN
  IF setting_key NOT IN ('payment_instructions','announcements','property_name','property_subtitle') THEN
    RETURN '';
  END IF;

  SELECT value INTO result
  FROM settings
  WHERE key = setting_key
  LIMIT 1;

  RETURN COALESCE(result, '');
END;
$$;

GRANT EXECUTE ON FUNCTION read_setting(text) TO anon;

-- ─────────────────────────────────────────────────────
-- 7. read_portal_settings — all tenant-visible settings in one call
-- ─────────────────────────────────────────────────────
-- The tenant portal needs several settings at once; one RPC beats four.
-- Same allowlist as read_setting.

CREATE OR REPLACE FUNCTION read_portal_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO result
  FROM settings
  WHERE key IN ('payment_instructions','announcements','property_name','property_subtitle');

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION read_portal_settings() TO anon;

-- ─────────────────────────────────────────────────────
-- 8. Optimistic concurrency for tenant rows
-- ─────────────────────────────────────────────────────
-- Every bill/template write PATCHes the whole jsonb array, so two admin
-- tabs (or phone + laptop) could silently overwrite each other's changes:
-- last write wins, earlier payments vanish. The portal now PATCHes with
-- `?rev=eq.<seen>` and bumps rev by 1 — a stale write matches zero rows,
-- and the app reloads fresh data instead of destroying the newer version.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rev bigint NOT NULL DEFAULT 0;
