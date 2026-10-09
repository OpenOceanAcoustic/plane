# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# ruff: noqa: E501

from django.db import migrations


# Preserve the existing native guard; a retained started state is not a new start.
FORWARD_SQL = r"""
CREATE OR REPLACE FUNCTION lab_native_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws uuid; bounty lab_bounty%ROWTYPE; desired_group text;
BEGIN
  ws := CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  PERFORM lab_wip_lock(ws);
  IF TG_OP='UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN PERFORM lab_wip_lock(OLD.workspace_id); END IF;
  IF TG_TABLE_NAME='issues' AND TG_OP='UPDATE' THEN
    SELECT * INTO bounty FROM lab_bounty WHERE issue_id = OLD.id;
    IF FOUND AND bounty.status NOT IN ('done','cancelled','rejected') THEN
      SELECT "group" INTO desired_group FROM states WHERE id=NEW.state_id;
      IF OLD.state_id IS DISTINCT FROM NEW.state_id AND desired_group='started' AND bounty.status IN ('open','publication_review') THEN
        RAISE EXCEPTION 'lab_bounty_workflow: team work must be approved and confirmed before start' USING ERRCODE='23514';
      END IF;
      IF desired_group IN ('completed','cancelled') OR NEW.parent_id IS NOT NULL THEN
        RAISE EXCEPTION 'lab_bounty_workflow: open team work requires independent acceptance' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
"""

REVERSE_SQL = FORWARD_SQL.replace(
    "IF OLD.state_id IS DISTINCT FROM NEW.state_id AND desired_group='started'",
    "IF desired_group='started'",
)


class Migration(migrations.Migration):
    dependencies = [("lab", "0011_public_duty_zero_revision")]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
