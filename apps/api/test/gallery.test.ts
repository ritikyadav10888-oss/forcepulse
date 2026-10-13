import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, signIn, startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64, 0)]);
const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(64, 0)]);

describe("tournament gallery (FR-MED-01 to 05, AC-08)", () => {
  it("organiser adds up to 50 photos and videos; the 51st is refused until one is removed", async () => {
    const org = await signIn(h, "9200000001");
    const t = (
      await h.http().post("/api/v1/tournaments").set(bearer(org.accessToken))
        .send({ name: "Gallery Cup", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual" }] })
        .expect(201)
    ).body;
    const upload = async (bytes: Buffer, name: string) =>
      (await h.http().post("/api/v1/uploads").set(bearer(org.accessToken)).field("kind", "media").attach("file", bytes, name).expect(201)).body;
    const add = (key: string, caption = "") => h.http().post(`/api/v1/tournaments/${t.id}/media`).set(bearer(org.accessToken)).send({ uploadKey: key, caption });

    const video = await upload(mp4, "final.mp4");
    expect(video.mime).toBe("video/mp4");
    expect((await upload(mov, "clip.mov")).mime).toBe("video/quicktime");
    const first = (await add(video.key, "Final point").expect(201)).body;
    expect(first).toMatchObject({ type: "video", caption: "Final point", url: `/api/v1/uploads/${video.key}` });

    for (let i = 1; i < 50; i++) await add((await upload(png, `p${i}.png`)).key).expect(201);
    const extra = await upload(png, "51.png");
    const full = await add(extra.key).expect(409);
    expect(full.body).toMatchObject({ code: "GALLERY_FULL", message: "The gallery holds 50 items. Remove one to add another." });

    await h.http().delete(`/api/v1/media/${first.id}`).set(bearer(org.accessToken)).expect(204);
    await add(extra.key).expect(201);

    const pub = await h.http().get(`/api/v1/tournaments/${t.id}/media`).expect(200);
    expect(pub.body.items).toHaveLength(50);
    await h.http().get(`/api/v1/uploads/${extra.key}`).expect(200); // public, downloadable
  });

  it("only the organiser can add, caption or remove", async () => {
    const org = await signIn(h, "9200000002");
    const other = await signIn(h, "9200000003");
    const t = (
      await h.http().post("/api/v1/tournaments").set(bearer(org.accessToken))
        .send({ name: "Private Gallery", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual" }] })
        .expect(201)
    ).body;
    const theirs = (await h.http().post("/api/v1/uploads").set(bearer(other.accessToken)).field("kind", "media").attach("file", png, "x.png").expect(201)).body;
    await h.http().post(`/api/v1/tournaments/${t.id}/media`).set(bearer(other.accessToken)).send({ uploadKey: theirs.key }).expect(403);
    // The organiser can't add someone else's upload either.
    await h.http().post(`/api/v1/tournaments/${t.id}/media`).set(bearer(org.accessToken)).send({ uploadKey: theirs.key }).expect(400);

    const mine = (await h.http().post("/api/v1/uploads").set(bearer(org.accessToken)).field("kind", "media").attach("file", png, "y.png").expect(201)).body;
    const item = (await h.http().post(`/api/v1/tournaments/${t.id}/media`).set(bearer(org.accessToken)).send({ uploadKey: mine.key }).expect(201)).body;
    await h.http().patch(`/api/v1/media/${item.id}`).set(bearer(other.accessToken)).send({ caption: "hijack" }).expect(403);
    expect((await h.http().patch(`/api/v1/media/${item.id}`).set(bearer(org.accessToken)).send({ caption: "Winners" }).expect(200)).body.caption).toBe("Winners");
    await h.http().delete(`/api/v1/media/${item.id}`).set(bearer(other.accessToken)).expect(403);
  });

  it("refuses photos over 5 MB in the gallery", async () => {
    const org = await signIn(h, "9200000004");
    const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024, 1)]);
    const res = await h.http().post("/api/v1/uploads").set(bearer(org.accessToken)).field("kind", "media").attach("file", big, "big.png").expect(400);
    expect(res.body.message).toBe("Photos must be 5 MB or smaller.");
  });

  it("makes a square preview for photos and a poster frame for videos (FR-MED-06)", async () => {
    const org = await signIn(h, "9200000009");
    const t = (
      await h.http().post("/api/v1/tournaments").set(bearer(org.accessToken))
        .send({ name: "Thumbs Cup", startsAt: "2026-11-20T03:30:00Z", endsAt: "2026-11-21T03:30:00Z", status: "enrollment_open", events: [{ sportId: "badminton", entryType: "individual" }] })
        .expect(201)
    ).body;
    const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#0b1f3a" } }).jpeg().toBuffer();
    const dir = mkdtempSync(path.join(tmpdir(), "fp-test-"));
    const clip = path.join(dir, "clip.mp4");
    execFileSync(ffmpegPath!, ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x120:d=2", "-pix_fmt", "yuv420p", clip]);

    for (const [bytes, name, type] of [[photo, "court.jpg", "photo"], [readFileSync(clip), "clip.mp4", "video"]] as const) {
      const up = (await h.http().post("/api/v1/uploads").set(bearer(org.accessToken)).field("kind", "media").attach("file", bytes, name).expect(201)).body;
      const item = (await h.http().post(`/api/v1/tournaments/${t.id}/media`).set(bearer(org.accessToken)).send({ uploadKey: up.key }).expect(201)).body;
      expect(item).toMatchObject({ type, thumbUrl: expect.stringMatching(/^\/api\/v1\/uploads\/upl_/) });
      // The preview is public, WebP and 480 x 480.
      const thumb = await h.http().get(item.thumbUrl).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); }).expect(200);
      expect(thumb.headers["content-type"]).toBe("image/webp");
      const meta = await sharp(thumb.body as Buffer).metadata();
      expect([meta.width, meta.height]).toEqual([480, 480]);
    }
  }, 60_000);
});
