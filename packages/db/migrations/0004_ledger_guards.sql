-- Ledger is append-only (NFR-11): corrections are new, reversing entries.
CREATE TRIGGER "ledger_entries_no_update_delete"
  BEFORE UPDATE OR DELETE ON "finance"."ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "platform"."audit_logs_append_only"();
--> statement-breakpoint
-- Each entry is a debit or a credit, never negative, never both.
ALTER TABLE "finance"."ledger_entries"
  ADD CONSTRAINT "ledger_entries_one_side"
  CHECK ("debit_paise" >= 0 AND "credit_paise" >= 0 AND ("debit_paise" = 0) <> ("credit_paise" = 0));
--> statement-breakpoint
-- Every transaction balances (debits = credits), checked when the transaction commits.
CREATE FUNCTION "finance"."ledger_transaction_balances"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  diff bigint;
BEGIN
  SELECT coalesce(sum("debit_paise"), 0) - coalesce(sum("credit_paise"), 0) INTO diff
    FROM "finance"."ledger_entries" WHERE "transaction_id" = NEW."transaction_id";
  IF diff <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (debits - credits = %)', NEW."transaction_id", diff;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_balanced"
  AFTER INSERT ON "finance"."ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "finance"."ledger_transaction_balances"();
