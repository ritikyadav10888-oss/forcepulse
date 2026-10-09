import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mediaItems, tournaments, uploads, type Db } from "@force-pulse/db";
import { ApiError } from "./common/api-error";
import { Authenticated, CurrentAuth, Public, type AuthContext } from "./common/policy";
import { DB } from "./common/tokens";
import { parse } from "./common/validate";
import { TournamentsService } from "./tournaments/tournaments.service";

/** FR-MED-01: one gallery per tournament, at most this many photos and videos together. */
export const GALLERY_LIMIT = 50;

const AddInput = z.object({ uploadKey: z.string().regex(/^upl_[a-z0-9]{16,40}$/), caption: z.string().trim().max(300).default("") }).strict();
const CaptionInput = z.object({ caption: z.string().trim().max(300) }).strict();

/** Tournament gallery (FR-MED-01 to 05). Files come from POST /uploads with kind "media". */
@Controller()
export class GalleryController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tournaments: TournamentsService,
  ) {}

  /** Anyone who can see the tournament can view, download and share its gallery (FR-MED-05). */
  @Get("tournaments/:id/media")
  @Public()
  async list(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth?: AuthContext) {
    await this.tournaments.get(id, auth);
    const rows = await this.db.select().from(mediaItems).where(eq(mediaItems.tournamentId, id)).orderBy(asc(mediaItems.createdAt));
    return { limit: GALLERY_LIMIT, items: rows.map(view) };
  }

  /** Only the tournament's organiser adds items; the 51st is refused (FR-MED-02, FR-MED-04). */
  @Post("tournaments/:id/media")
  @Authenticated()
  async add(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const { uploadKey, caption } = parse(AddInput, body);
    await this.tournaments.manageable(auth, id);
    const row = await this.db.transaction(async (tx) => {
      // Lock the tournament so two uploads at once can't both take the 50th place.
      await tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, id)).for("update");
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(mediaItems).where(eq(mediaItems.tournamentId, id));
      if (n >= GALLERY_LIMIT) throw new ApiError("GALLERY_FULL", `The gallery holds ${GALLERY_LIMIT} items. Remove one to add another.`);
      const [file] = await tx.select().from(uploads).where(and(eq(uploads.key, uploadKey), eq(uploads.ownerUserId, auth.userId), eq(uploads.kind, "media")));
      if (!file) throw new ApiError("BAD_REQUEST", "Upload the photo or video first (kind \"media\"), then add it.");
      const [item] = await tx
        .insert(mediaItems)
        .values({ tournamentId: id, uploadKey, type: file.mime.startsWith("video/") ? "video" : "photo", caption, sizeBytes: file.sizeBytes, uploadedByUserId: auth.userId })
        .onConflictDoNothing()
        .returning();
      if (!item) throw new ApiError("CONFLICT", "This file is already in a gallery.");
      return item;
    });
    return view(row);
  }

  @Patch("media/:id")
  @Authenticated()
  async caption(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    const item = await this.item(auth, id);
    const [row] = await this.db.update(mediaItems).set({ caption: parse(CaptionInput, body).caption }).where(eq(mediaItems.id, item.id)).returning();
    return view(row);
  }

  /** Frees a place in the gallery. */
  @Delete("media/:id")
  @HttpCode(204)
  @Authenticated()
  async remove(@Param("id", ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    const item = await this.item(auth, id);
    // shortcut: the file stays in storage (no delete in FileStore yet); add delete + CDN purge with S3.
    await this.db.delete(mediaItems).where(eq(mediaItems.id, item.id));
  }

  private async item(auth: AuthContext, id: string) {
    const [item] = await this.db.select().from(mediaItems).where(eq(mediaItems.id, id));
    if (!item) throw new ApiError("NOT_FOUND", "No such gallery item.");
    await this.tournaments.manageable(auth, item.tournamentId);
    return item;
  }
}

function view(m: typeof mediaItems.$inferSelect) {
  return { ...m, url: `/api/v1/uploads/${m.uploadKey}`, createdAt: m.createdAt.toISOString() };
}
