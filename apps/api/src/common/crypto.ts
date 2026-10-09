import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for data that must be readable again but never stored in clear (bank account numbers, NFR-09).
// Format: base64url(iv).base64url(tag).base64url(ciphertext). Later: a KMS-held key (System Design 12.1).

export function encrypt(hexKey: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(hexKey: string, sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
