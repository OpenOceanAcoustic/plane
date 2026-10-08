# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import migrations


SQL = r"""
CREATE OR REPLACE FUNCTION lab_financial_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_record jsonb; after_record jsonb; key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lab_financial_history: append a reversal; financial history cannot be deleted'
      USING ERRCODE='23514';
  END IF;
  before_record := to_jsonb(OLD);
  after_record := to_jsonb(NEW);
  -- Native user/project deletion may anonymize foreign keys. Identifying
  -- snapshots and every monetary/business field remain immutable.
  FOREACH key IN ARRAY ARRAY['actor_id', 'user_id', 'project_id'] LOOP
    IF before_record ? key AND before_record->key IS DISTINCT FROM after_record->key THEN
      IF after_record->key <> 'null'::jsonb OR before_record->key = 'null'::jsonb THEN
        RAISE EXCEPTION 'lab_financial_history: foreign key may only be anonymized'
      USING ERRCODE='23514';
      END IF;
    END IF;
    before_record := before_record - key;
    after_record := after_record - key;
  END LOOP;
  IF before_record IS DISTINCT FROM after_record THEN
    RAISE EXCEPTION 'lab_financial_history: append a correction; financial history cannot be overwritten'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE history_table text;
BEGIN
  FOREACH history_table IN ARRAY ARRAY[
    'lab_rewardformula', 'lab_stagebudget', 'lab_financialoperation',
    'lab_cashbatch', 'lab_financialentry', 'lab_rewardforecast',
    'lab_rewardsettlement', 'lab_paymentcommitment',
    'lab_commitmentcancellation', 'lab_offlinepayment', 'lab_audit'
  ] LOOP
    EXECUTE format('CREATE TRIGGER lab_financial_history BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION lab_financial_history_guard()', history_table);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION lab_project_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_names text[]; action_name text; actor_uuid uuid; actor_label text; snapshot jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_names := ARRAY['project.created'];
    actor_uuid := NEW.created_by_id;
    snapshot := jsonb_build_object('project_id', NEW.id, 'project_name', NEW.name, 'identifier', NEW.identifier);
  ELSE
    action_names := ARRAY[]::text[];
    actor_uuid := NEW.updated_by_id;
    IF OLD.project_lead_id IS DISTINCT FROM NEW.project_lead_id THEN
      action_names := array_append(action_names, 'project.lead_changed');
    END IF;
    IF OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN
      action_names := array_append(action_names,
        CASE WHEN NEW.archived_at IS NULL THEN 'project.unarchived' ELSE 'project.archived' END);
    END IF;
    IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      action_names := array_append(action_names,
        CASE WHEN NEW.deleted_at IS NULL THEN 'project.restored' ELSE 'project.deleted' END);
    END IF;
    snapshot := jsonb_build_object(
      'project_id', NEW.id, 'project_name', NEW.name, 'identifier', NEW.identifier,
      'before', jsonb_build_object('project_lead_id', OLD.project_lead_id,
        'archived_at', OLD.archived_at, 'deleted_at', OLD.deleted_at),
      'after', jsonb_build_object('project_lead_id', NEW.project_lead_id,
        'archived_at', NEW.archived_at, 'deleted_at', NEW.deleted_at)
    );
  END IF;
  SELECT COALESCE(NULLIF(display_name, ''), username) INTO actor_label FROM users WHERE id=actor_uuid;
  FOREACH action_name IN ARRAY action_names LOOP
    INSERT INTO lab_audit (id, created_at, actor_id, actor_name, workspace_id_snapshot, action, object_id, details)
    VALUES (gen_random_uuid(), statement_timestamp(), actor_uuid,
      COALESCE(actor_label, '系统（未记录操作人）'), NEW.workspace_id, action_name, NEW.id, snapshot);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_project_event AFTER INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION lab_project_event();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS lab_project_event ON projects;
DROP FUNCTION IF EXISTS lab_project_event();
DO $$
DECLARE history_table text;
BEGIN
  FOREACH history_table IN ARRAY ARRAY[
    'lab_rewardformula', 'lab_stagebudget', 'lab_financialoperation',
    'lab_cashbatch', 'lab_financialentry', 'lab_rewardforecast',
    'lab_rewardsettlement', 'lab_paymentcommitment',
    'lab_commitmentcancellation', 'lab_offlinepayment', 'lab_audit'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lab_financial_history ON %I', history_table);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS lab_financial_history_guard();
"""


class Migration(migrations.Migration):
    dependencies = [("lab", "0007_finance_bounty")]
    operations = [migrations.RunSQL(SQL, REVERSE_SQL)]
