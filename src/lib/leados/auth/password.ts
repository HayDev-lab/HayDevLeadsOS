// PRODUCTION PASSWORD HASHING (v0.17 spec 20).
//
// Primary: Bun.password (bcrypt, cost 12) — the runtime for dev, tests and
// the production standalone server (`bun .next/standalone/server.js`).
// Fallback: node:crypto scrypt (N=16384, r=8, p=1) so the server also runs
// under plain Node without weakening verification.
//
// Stored formats are self-describing:
//   bcrypt → "$2b$12$..."
//   scrypt → "scrypt$16384$8$1$<salt-b64>$<hash-b64>"
// verifyPassword detects the format; hashes are never plaintext.

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const BCRYPT_COST = 12;

type BunPassword = {
  hash: (password: string, algorithm: "bcrypt", config?: { cost?: number }) => Promise<string>;
  verify: (password: string, hash: string) => Promise<boolean>;
};

function bunPassword(): BunPassword | null {
  const anyGlobal = globalThis as { Bun?: { password?: BunPassword } };
  const pw = anyGlobal.Bun?.password;
  if (pw && typeof pw.hash === "function" && typeof pw.verify === "function") return pw;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const pw = bunPassword();
  if (pw) {
    return pw.hash(password, "bcrypt", { cost: BCRYPT_COST });
  }
  const { randomBytes, scrypt } = await import("node:crypto");
  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    if (hash.startsWith("scrypt$")) {
      const { timingSafeEqual, scrypt } = await import("node:crypto");
      const parts = hash.split("$");
      if (parts.length !== 6) return false;
      const N = parseInt(parts[1], 10);
      const r = parseInt(parts[2], 10);
      const p = parseInt(parts[3], 10);
      const salt = Buffer.from(parts[4], "base64");
      const expected = Buffer.from(parts[5], "base64");
      const derived = await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, expected.length, { N, r, p }, (err, key) =>
          err ? reject(err) : resolve(key)
        );
      });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    }
    // bcrypt / argon2 (Bun) formats
    const pw = bunPassword();
    if (!pw) return false;
    return await pw.verify(password, hash);
  } catch {
    return false;
  }
}

/** Password policy (zod-free helper usable from scripts too). */
export function validatePasswordPolicy(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(password)) return "Password must contain a letter.";
  if (!/[0-9]/.test(password)) return "Password must contain a digit.";
  return null;
}
