import { Inject } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { eq } from "drizzle-orm";
import type { Server, Socket } from "socket.io";
import { matches, type Db } from "@force-pulse/db";
import { TokensService } from "./auth/tokens.service";
import type { AuthContext } from "./common/policy";
import { DB } from "./common/tokens";
import { RolesService } from "./roles/roles.service";
import { TournamentsService } from "./tournaments/tournaments.service";

const ROOM = /^(match|tournament):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Live updates (NFR-03, System Design 8.1). Rooms: match:<id> and tournament:<id> (public, same visibility as the
 * HTTP pages) and user:<id> (joined on connect with a valid access token). Every message carries full state,
 * so a client that misses one is corrected by the next.
 * shortcut: one API instance; add the Socket.IO Redis adapter when the API runs on more than one server.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() private server?: Server;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tokens: TokensService,
    private readonly roles: RolesService,
    private readonly tournaments: TournamentsService,
  ) {}

  /** Signed-in clients (auth: { token }) also get their own user room. A bad token just means a public connection. */
  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) return;
    try {
      const payload = await this.tokens.verifyAccess(token);
      if ((await this.tokens.sessionStatus(payload.sid, payload.sub)) !== "ok") return;
      const { roles, suspendedRoles } = await this.roles.state(payload.sub);
      const auth: AuthContext = { userId: payload.sub, sessionId: payload.sid, roles, suspendedRoles };
      socket.data.auth = auth;
      await socket.join(`user:${auth.userId}`);
    } catch {
      // public connection
    }
  }

  @SubscribeMessage("subscribe")
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() room: unknown): Promise<{ ok: boolean; error?: string }> {
    const m = typeof room === "string" ? ROOM.exec(room) : null;
    if (!m) return { ok: false, error: "Unknown room" };
    try {
      const tournamentId = m[1] === "tournament" ? m[2] : (await this.db.select({ t: matches.tournamentId }).from(matches).where(eq(matches.id, m[2])))[0]?.t;
      if (!tournamentId) return { ok: false, error: "Not found" };
      await this.tournaments.get(tournamentId, socket.data.auth as AuthContext | undefined); // drafts stay private
      await socket.join(room as string);
      return { ok: true };
    } catch {
      return { ok: false, error: "Not found" };
    }
  }

  @SubscribeMessage("unsubscribe")
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() room: unknown) {
    if (typeof room === "string") await socket.leave(room);
    return { ok: true };
  }

  emit(room: string, event: string, data: unknown) {
    this.server?.to(room).emit(event, data);
  }
}
