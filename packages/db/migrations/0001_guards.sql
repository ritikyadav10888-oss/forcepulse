-- Only known roles can be stored (SRS v2 2.2).
ALTER TABLE "identity"."user_roles"
  ADD CONSTRAINT "user_roles_role_check"
  CHECK ("role" IN ('player', 'organiser', 'scorer', 'team_owner', 'admin', 'super_admin'));
--> statement-breakpoint
-- Audit log is append-only (NFR-11): updates and deletes are refused by the database itself.
CREATE FUNCTION "platform"."audit_logs_append_only"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "platform"."audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "platform"."audit_logs_append_only"();
