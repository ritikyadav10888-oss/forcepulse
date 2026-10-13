import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

/** What the auction exports need from the live auction view. */
export interface ExportView {
  title: string;
  purse: number;
  teams: { id: string; name: string; pointsLeft: number; players: number }[];
  lots: { name: string; category: string; status: string; soldTeamId: string | null; soldPoints: number | null; retained: boolean }[];
}

const pts = (n: number | null) => (n ?? 0).toLocaleString("en-IN");

/** Squads by team, then everyone sold and unsold (FR-AUC-20). */
function squads(v: ExportView) {
  return v.teams.map((t) => {
    const players = v.lots.filter((l) => l.status === "sold" && l.soldTeamId === t.id);
    return { team: t.name, spent: v.purse - t.pointsLeft, left: t.pointsLeft, players };
  });
}

export async function auctionXlsx(v: ExportView): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Force Pulse";
  const team = (id: string | null) => v.teams.find((t) => t.id === id)?.name ?? "";

  const summary = wb.addWorksheet("Teams");
  summary.columns = [
    { header: "Team", key: "team", width: 26 },
    { header: "Players", key: "players", width: 10 },
    { header: "Points spent", key: "spent", width: 14 },
    { header: "Points left", key: "left", width: 14 },
  ];
  for (const s of squads(v)) summary.addRow({ team: s.team, players: s.players.length, spent: s.spent, left: s.left });

  const all = wb.addWorksheet("Players");
  all.columns = [
    { header: "Player", key: "name", width: 26 },
    { header: "Category", key: "category", width: 14 },
    { header: "Result", key: "status", width: 12 },
    { header: "Team", key: "team", width: 26 },
    { header: "Points", key: "points", width: 12 },
  ];
  for (const l of v.lots) all.addRow({ name: l.name, category: l.category, status: l.retained ? "retained" : l.status, team: team(l.soldTeamId), points: l.soldPoints ?? "" });

  for (const ws of [summary, all]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function auctionPdf(v: ExportView): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `${v.title} – auction results`, Author: "Force Pulse" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0b1220").text(v.title, left);
  doc.font("Helvetica").fontSize(10).fillColor("#5b6270").text(`Auction results · purse ${pts(v.purse)} points per team`);
  doc.moveDown();

  for (const s of squads(v)) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.rect(left, doc.y, width, 22).fill("#0b1f3a");
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff").text(s.team, left + 8, doc.y + 6, { width: width / 2 });
    doc.font("Helvetica").fontSize(9).text(`${s.players.length} players · spent ${pts(s.spent)} · left ${pts(s.left)}`, left + width / 2, doc.y - 12, { width: width / 2 - 8, align: "right" });
    doc.moveDown(0.8);
    doc.fillColor("#0b1220").fontSize(10);
    for (const p of s.players) {
      const y = doc.y;
      doc.font("Helvetica").text(`${p.name}${p.retained ? " (retained)" : ""}`, left + 8, y, { width: width * 0.5 });
      doc.text(p.category, left + width * 0.5, y, { width: width * 0.25 });
      doc.text(pts(p.soldPoints), left + width * 0.75, y, { width: width * 0.25 - 8, align: "right" });
      doc.moveDown(0.3);
    }
    if (!s.players.length) doc.font("Helvetica").fillColor("#5b6270").text("No players yet.", left + 8);
    doc.moveDown();
  }

  const unsold = v.lots.filter((l) => l.status === "unsold" || l.status === "upcoming");
  if (unsold.length) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0b1220").text("Unsold", left);
    doc.font("Helvetica").fontSize(10);
    for (const l of unsold) doc.text(`${l.name} · ${l.category}`, left + 8);
  }
  doc.end();
  return done;
}
