# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import migrations


SQL = """
DO $$
DECLARE history_table text;
BEGIN
  FOREACH history_table IN ARRAY ARRAY[
    'lab_publicdutyaward', 'lab_publicdutycommitment', 'lab_publicdutypayment'
  ] LOOP
    EXECUTE format('CREATE TRIGGER lab_financial_history BEFORE UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION lab_financial_history_guard()', history_table);
  END LOOP;
END $$;
"""
REVERSE_SQL = """
DO $$
DECLARE history_table text;
BEGIN
  FOREACH history_table IN ARRAY ARRAY[
    'lab_publicdutyaward', 'lab_publicdutycommitment', 'lab_publicdutypayment'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lab_financial_history ON %I', history_table);
  END LOOP;
END $$;
"""


class Migration(migrations.Migration):
    dependencies = [("lab", "0009_public_duties_forecast_actor")]
    operations = [migrations.RunSQL(SQL, REVERSE_SQL)]
