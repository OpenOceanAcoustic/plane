# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# ruff: noqa: E501

from django.db import migrations

# Keep every existing trigger and transaction lock. Only workload rejection is
# removed; budget, workflow, permissions and immutable-ledger guards stay active.
FORWARD_SQL = r"""
CREATE OR REPLACE FUNCTION lab_wip_validate(ws uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Workload is advisory and is reported by the personal workload endpoint.
  RETURN;
END $$;
"""

REVERSE_SQL = r"""
CREATE OR REPLACE FUNCTION lab_wip_validate(ws uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE violation record; baseline jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lab_workspacepolicy WHERE workspace_id = ws) THEN RETURN; END IF;
  baseline:=COALESCE(NULLIF(current_setting('lab.wip_baseline',true),'')::jsonb,'{}'::jsonb);
  WITH counts AS (
    SELECT person, count(DISTINCT task) AS active, count(DISTINCT task) FILTER (WHERE major) AS major,
      jsonb_agg(DISTINCT task::text) AS active_tasks,
      COALESCE(jsonb_agg(DISTINCT task::text) FILTER (WHERE major),'[]'::jsonb) AS major_tasks
    FROM lab_work() WHERE workspace=ws GROUP BY person
  ), limits AS (
    SELECT user_id, max(active_limit) AS active, max(major_limit) AS major
    FROM lab_wipexception WHERE workspace_id = ws AND expires_at > statement_timestamp() GROUP BY user_id
  )
  SELECT c.* INTO violation FROM counts c LEFT JOIN limits l ON l.user_id = c.person
  -- Expired exceptions allow existing work to finish, but cannot admit new
  -- tasks while over quota. Comparing identities also rejects replacements.
  WHERE (c.active > COALESCE(l.active,2) AND NOT c.active_tasks <@
    COALESCE(baseline->(ws::text || ':' || c.person::text)->'active','[]'::jsonb))
    OR (c.major > COALESCE(l.major,1) AND NOT c.major_tasks <@
    COALESCE(baseline->(ws::text || ':' || c.person::text)->'major','[]'::jsonb)) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'lab_wip_limit: active <= 2, major <= 1 unless an approved exception exists' USING ERRCODE='23514';
  END IF;
END $$;
"""


class Migration(migrations.Migration):
    dependencies = [("lab", "0022_project_vc_budget_entries")]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
