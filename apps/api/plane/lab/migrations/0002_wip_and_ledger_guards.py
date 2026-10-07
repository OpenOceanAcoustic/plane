# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import migrations

SQL = r"""
CREATE OR REPLACE FUNCTION lab_wip_lock(ws uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM lab_workspacepolicy WHERE workspace_id = ws) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('lab-wip:' || ws::text, 0));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION lab_wip_validate(ws uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE violation record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lab_workspacepolicy WHERE workspace_id = ws) THEN RETURN; END IF;
  WITH work AS (
    SELECT ia.assignee_id AS person, i.id AS task, COALESCE(b.major, false) AS major
    FROM issue_assignees ia JOIN issues i ON i.id = ia.issue_id JOIN states s ON s.id = i.state_id
    LEFT JOIN lab_bounty b ON b.issue_id = i.id
    LEFT JOIN lab_allocation a ON a.bounty_id = b.id AND a.user_id = ia.assignee_id AND a.approved
    WHERE i.workspace_id = ws AND i.deleted_at IS NULL AND ia.deleted_at IS NULL
      AND i.archived_at IS NULL AND NOT i.is_draft AND s.deleted_at IS NULL AND s."group" = 'started'
      AND NOT COALESCE(a.closed, false)
    UNION
    SELECT a.user_id AS person, b.issue_id_snapshot AS task, b.major
    FROM lab_allocation a JOIN lab_bounty b ON b.id = a.bounty_id JOIN lab_stage st ON st.id = b.stage_id
    WHERE st.workspace_id = ws AND a.user_id IS NOT NULL AND a.approved AND NOT a.closed
      AND b.status IN ('active', 'review', 'acceptance_review', 'partial', 'rework', 'rejected')
  ), counts AS (
    SELECT person, count(DISTINCT task) AS active, count(DISTINCT task) FILTER (WHERE major) AS major
    FROM work GROUP BY person
  ), limits AS (
    SELECT user_id, max(active_limit) AS active, max(major_limit) AS major
    FROM lab_wipexception WHERE workspace_id = ws AND expires_at > statement_timestamp() GROUP BY user_id
  )
  SELECT c.* INTO violation FROM counts c LEFT JOIN limits l ON l.user_id = c.person
  WHERE c.active > COALESCE(l.active,2) OR c.major > COALESCE(l.major,1) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'lab_wip_limit: active <= 2, major <= 1 unless an approved exception exists' USING ERRCODE='23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION lab_native_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws uuid; bounty lab_bounty%ROWTYPE; desired_group text;
BEGIN
  ws := CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  PERFORM lab_wip_lock(ws);
  IF TG_OP='UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN PERFORM lab_wip_lock(OLD.workspace_id); END IF;
  IF TG_TABLE_NAME='issues' AND TG_OP='UPDATE' THEN
    SELECT * INTO bounty FROM lab_bounty WHERE issue_id = OLD.id;
    IF FOUND AND bounty.status NOT IN ('done','cancelled') THEN
      SELECT "group" INTO desired_group FROM states WHERE id=NEW.state_id;
      IF desired_group IN ('completed','cancelled') OR NEW.parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'lab_bounty_workflow: open team work requires independent acceptance' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION lab_native_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lab_wip_validate(CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END);
  IF TG_OP='UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN PERFORM lab_wip_validate(OLD.workspace_id); END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER lab_issue_before BEFORE INSERT OR UPDATE OR DELETE ON issues FOR EACH ROW EXECUTE FUNCTION lab_native_before();
CREATE TRIGGER lab_issue_after AFTER INSERT OR UPDATE OR DELETE ON issues FOR EACH ROW EXECUTE FUNCTION lab_native_after();
CREATE TRIGGER lab_assignee_before BEFORE INSERT OR UPDATE OR DELETE ON issue_assignees FOR EACH ROW EXECUTE FUNCTION lab_native_before();
CREATE TRIGGER lab_assignee_after AFTER INSERT OR UPDATE OR DELETE ON issue_assignees FOR EACH ROW EXECUTE FUNCTION lab_native_after();

CREATE OR REPLACE FUNCTION lab_business_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws uuid;
BEGIN
  IF TG_TABLE_NAME='lab_bounty' THEN SELECT workspace_id INTO ws FROM lab_stage WHERE id=NEW.stage_id;
  ELSIF TG_TABLE_NAME='lab_allocation' THEN SELECT st.workspace_id INTO ws FROM lab_bounty b JOIN lab_stage st ON st.id=b.stage_id WHERE b.id=NEW.bounty_id;
  ELSE ws:=NEW.workspace_id; END IF;
  PERFORM lab_wip_lock(ws);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION lab_business_after() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws uuid;
BEGIN
  IF TG_TABLE_NAME='lab_bounty' THEN SELECT workspace_id INTO ws FROM lab_stage WHERE id=NEW.stage_id;
  ELSIF TG_TABLE_NAME='lab_allocation' THEN SELECT st.workspace_id INTO ws FROM lab_bounty b JOIN lab_stage st ON st.id=b.stage_id WHERE b.id=NEW.bounty_id;
  ELSE ws:=NEW.workspace_id; END IF;
  PERFORM lab_wip_validate(ws);
  RETURN NULL;
END $$;

CREATE TRIGGER lab_bounty_before BEFORE INSERT OR UPDATE ON lab_bounty FOR EACH ROW EXECUTE FUNCTION lab_business_before();
CREATE TRIGGER lab_bounty_after AFTER INSERT OR UPDATE ON lab_bounty FOR EACH ROW EXECUTE FUNCTION lab_business_after();
CREATE TRIGGER lab_allocation_before BEFORE INSERT OR UPDATE ON lab_allocation FOR EACH ROW EXECUTE FUNCTION lab_business_before();
CREATE TRIGGER lab_allocation_after AFTER INSERT OR UPDATE ON lab_allocation FOR EACH ROW EXECUTE FUNCTION lab_business_after();

CREATE OR REPLACE FUNCTION lab_state_before() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lab_wip_lock(CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END);
  IF TG_OP='UPDATE' AND NEW."group" IN ('completed','cancelled') AND OLD."group" IS DISTINCT FROM NEW."group"
     AND EXISTS (SELECT 1 FROM issues i JOIN lab_bounty b ON b.issue_id=i.id WHERE i.state_id=OLD.id AND b.status NOT IN ('done','cancelled')) THEN
    RAISE EXCEPTION 'lab_bounty_workflow: state group cannot bypass acceptance' USING ERRCODE='23514';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE OR REPLACE FUNCTION lab_state_after() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lab_wip_validate(CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER lab_state_before BEFORE UPDATE OR DELETE ON states FOR EACH ROW EXECUTE FUNCTION lab_state_before();
CREATE TRIGGER lab_state_after AFTER UPDATE OR DELETE ON states FOR EACH ROW EXECUTE FUNCTION lab_state_after();

CREATE OR REPLACE FUNCTION lab_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'lab_ledger_immutable: contributions require an appended reversal' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(OLD) - 'actor_id') IS DISTINCT FROM (to_jsonb(NEW) - 'actor_id') THEN
    RAISE EXCEPTION 'lab_ledger_immutable: contributions require an appended reversal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_ledger_immutable BEFORE UPDATE OR DELETE ON lab_ledger FOR EACH ROW EXECUTE FUNCTION lab_ledger_immutable();

CREATE OR REPLACE FUNCTION lab_stage_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.budget IS DISTINCT FROM NEW.budget OR OLD.frozen_at IS DISTINCT FROM NEW.frozen_at THEN
    RAISE EXCEPTION 'lab_stage_frozen: stage budget is frozen' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_stage_frozen BEFORE UPDATE ON lab_stage FOR EACH ROW EXECUTE FUNCTION lab_stage_frozen();
"""

REVERSE = r"""
DROP TRIGGER IF EXISTS lab_stage_frozen ON lab_stage;
DROP TRIGGER IF EXISTS lab_ledger_immutable ON lab_ledger;
DROP TRIGGER IF EXISTS lab_state_before ON states;
DROP TRIGGER IF EXISTS lab_state_after ON states;
DROP TRIGGER IF EXISTS lab_issue_before ON issues;
DROP TRIGGER IF EXISTS lab_issue_after ON issues;
DROP TRIGGER IF EXISTS lab_assignee_before ON issue_assignees;
DROP TRIGGER IF EXISTS lab_assignee_after ON issue_assignees;
DROP TRIGGER IF EXISTS lab_bounty_before ON lab_bounty;
DROP TRIGGER IF EXISTS lab_bounty_after ON lab_bounty;
DROP TRIGGER IF EXISTS lab_allocation_before ON lab_allocation;
DROP TRIGGER IF EXISTS lab_allocation_after ON lab_allocation;
DROP FUNCTION IF EXISTS lab_stage_frozen(), lab_ledger_immutable(), lab_state_before(), lab_state_after(), lab_native_before(), lab_native_after(), lab_business_before(), lab_business_after(), lab_wip_validate(uuid), lab_wip_lock(uuid);
"""


class Migration(migrations.Migration):
    dependencies = [("lab", "0001_initial")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
