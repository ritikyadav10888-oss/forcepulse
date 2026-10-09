import { Inject, Injectable } from "@nestjs/common";
import { auditLogs, type Db } from "@force-pulse/db";
import { DB } from "./tokens";

export interface AuditEntry {
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  userId: string | null;
}

/** Writes the append-only audit log (NFR-11). Pass the transaction so the log commits with the change. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(entry: AuditEntry, tx: Db = this.db): Promise<void> {
    await tx.insert(auditLogs).values({
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
      userId: entry.userId,
    });
  }
}
