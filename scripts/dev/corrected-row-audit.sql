-- DEVELOPMENT / SCRATCH-DATABASE INSTRUMENTATION ONLY. Not a migration; not deployed to any real database without separate approval.
-- Appends a row to corrected_row_audit whenever a recruiting_events row that carries a person's correction, confirmation or ignore is changed or deleted, naming the columns,
-- the transaction and the connection's application_name, so the writer of an unexpected change can be identified. It stores column NAMES only, never values.
CREATE TABLE IF NOT EXISTS corrected_row_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  event_id uuid NOT NULL,
  op text NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  application_name text,
  columns_changed text[] NOT NULL
);
CREATE OR REPLACE FUNCTION audit_corrected_row() RETURNS trigger AS $$
DECLARE cols text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.correction IS NOT NULL THEN
      INSERT INTO corrected_row_audit(event_id, op, application_name, columns_changed) VALUES (OLD.id, 'DELETE', current_setting('application_name', true), ARRAY['*']);
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.correction IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(array_agg(key ORDER BY key), '{}') INTO cols
    FROM jsonb_each(to_jsonb(NEW)) n FULL JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
   WHERE n.value IS DISTINCT FROM o.value;
  IF array_length(cols, 1) > 0 THEN
    INSERT INTO corrected_row_audit(event_id, op, application_name, columns_changed) VALUES (OLD.id, 'UPDATE', current_setting('application_name', true), cols);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS corrected_row_audit_trg ON recruiting_events;
CREATE TRIGGER corrected_row_audit_trg AFTER UPDATE OR DELETE ON recruiting_events FOR EACH ROW EXECUTE FUNCTION audit_corrected_row();
