import PDFDocument from "pdfkit";

export interface ReceiptData {
  tournamentName: string;
  organiserContact: string;
  paidAt: string;
  method: string;
  razorpayPaymentId: string;
  lines: { label: string; feePaise: number }[];
  entryFeePaise: number;
  convenienceFeePaise: number;
  totalPaise: number;
}

// The PDF's built-in font has no rupee sign, so amounts read "Rs 1,000.00".
const rs = (paise: number) => `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One-page A5 payment receipt (FR-PAY-09). */
export function receiptPdf(r: ReceiptData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A5", margin: 36, info: { Title: `Force Pulse receipt ${r.razorpayPaymentId}`, Author: "Force Pulse" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#0b1220");
    doc.text(label, left, y, { width: width * 0.65 });
    doc.text(value, left + width * 0.65, y, { width: width * 0.35, align: "right" });
    doc.moveDown(0.4);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor("#ddd5c7").lineWidth(0.5).stroke();
    doc.moveDown(0.4);
  };

  doc.rect(0, 0, doc.page.width, 64).fill("#0b1f3a");
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff").text("FORCE PULSE", left, 24);
  doc.font("Helvetica").fontSize(10).text("Payment receipt", left, 26, { width, align: "right" });

  doc.y = 90;
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0b1220").text(r.tournamentName, left);
  doc.font("Helvetica").fontSize(9).fillColor("#5b6270").text(`Paid ${r.paidAt} · ${r.method} · Razorpay ${r.razorpayPaymentId}`, left);
  doc.moveDown(1.2);

  for (const l of r.lines) row(l.label, rs(l.feePaise));
  row("Entry fees", rs(r.entryFeePaise));
  row("Convenience fee", rs(r.convenienceFeePaise));
  row("Total paid", rs(r.totalPaise), true);

  doc.moveDown(1);
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#5b6270")
    .text(`Questions about this entry, refunds or withdrawals: contact the organiser${r.organiserContact ? `, ${r.organiserContact}` : ""}. No GST is charged.`, left, doc.y, { width });
  doc.end();
  return done;
}
