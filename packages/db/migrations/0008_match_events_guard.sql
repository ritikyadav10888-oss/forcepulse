-- Scoring events are append-only (FR-SCR-09: every edit is kept). Undo is a new event.
CREATE TRIGGER "match_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "competition"."match_events"
  FOR EACH ROW EXECUTE FUNCTION "platform"."audit_logs_append_only"();
