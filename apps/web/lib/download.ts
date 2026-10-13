import { PUBLIC_API_URL } from "./api";

/** Downloads a signed-in file (CSV exports) as the browser's normal file save. */
export async function download(path: string, token: string | null, filename: string) {
  const r = await fetch(PUBLIC_API_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error("Couldn't download the file.");
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
