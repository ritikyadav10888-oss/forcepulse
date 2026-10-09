import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { pincodes } from "./schema";

/** Splits one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Reads the India Post "All India Pincode Directory" CSV from data.gov.in
 * (columns include pincode, district, statename; one row per post office).
 * Keeps one row per pincode; the district is used as the city.
 */
export function parsePincodeCsv(text: string): (typeof pincodes.$inferInsert)[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Pincode CSV is missing the "${name}" column`);
    return i;
  };
  const [pin, district, state] = [col("pincode"), col("district"), col("statename")];
  const rows = new Map<string, typeof pincodes.$inferInsert>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const code = cells[pin];
    if (!/^[1-9]\d{5}$/.test(code ?? "") || rows.has(code)) continue;
    const d = titleCase(cells[district] ?? "");
    rows.set(code, { pincode: code, city: d, district: d, state: titleCase(cells[state] ?? "") });
  }
  return [...rows.values()];
}

/** Loads (or refreshes) the pincode table from a CSV file. Returns the number of pincodes. */
export async function loadPincodes(db: Db, csvPath: string): Promise<number> {
  const rows = parsePincodeCsv(readFileSync(csvPath, "utf8"));
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(pincodes)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({ target: pincodes.pincode, set: { city: sql`excluded.city`, district: sql`excluded.district`, state: sql`excluded.state` } });
  }
  return rows.length;
}
