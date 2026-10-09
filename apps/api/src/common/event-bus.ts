import { Injectable, Logger } from "@nestjs/common";

// Domain events between modules (System Design 3). Week 1 runs them in-process; week 4 moves
// them to Redis Streams with an outbox table, keeping this publish/subscribe interface.

export type DomainEvent =
  | { type: "TournamentCreated"; tournamentId: string; organiserUserId: string }
  | { type: "ScorerAssigned"; matchId: string; scorerUserId: string }
  | { type: "MatchStartedBy"; matchId: string; userId: string }
  /** Payments schedules the organiser payout at close + 2 days (week 3). */
  | { type: "RegistrationClosed"; tournamentId: string; closedAt: string };

type Handler<T extends DomainEvent["type"]> = (event: Extract<DomainEvent, { type: T }>) => Promise<void> | void;

@Injectable()
export class EventBus {
  private readonly log = new Logger("EventBus");
  private readonly handlers = new Map<DomainEvent["type"], ((event: DomainEvent) => Promise<void> | void)[]>();

  on<T extends DomainEvent["type"]>(type: T, handler: Handler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as (event: DomainEvent) => Promise<void> | void);
    this.handlers.set(type, list);
  }

  /** Runs every handler in order. A failing handler is logged and does not stop the others. */
  async publish(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        await handler(event);
      } catch (err) {
        this.log.error(`${event.type} handler failed: ${err instanceof Error ? err.stack : String(err)}`);
      }
    }
  }
}
