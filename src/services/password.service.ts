// Password Hasher — salted, one-way scrypt hashing with constant-time verify.
//
// This standalone component (no Prisma, no Express) computes and verifies the
// Password Hash stored on a User Record. It uses Node's built-in `crypto`
// module so no native dependency is added (see design → Research: password
// hashing approach):
//
//   - `hashPassword` derives a key with `crypto.scrypt` over a fresh random
//     salt generated per call, so two identical plaintext Passwords produce
//     different Password Hashes (Req 6.1).
//   - `verifyPassword` recomputes the derived key with the stored parameters
//     and salt, then compares with `crypto.timingSafeEqual` so the comparison
//     is constant-time with respect to the derived-key contents (Req 6.2, 6.3).
//
// Each Password Hash is stored as a single self-describing string so the cost
// parameters and salt travel with the hash and can evolve without a schema
// change:
//
//   scrypt$<N>$<r>$<p>$<saltBase64>$<derivedKeyBase64>
//
// The plaintext Password is never logged, returned, or persisted (Req 6.5, 6.6).

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import {
  SCRYPT_KEYLEN,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  SCRYPT_SALT_BYTES,
} from './password.service.constant';
import type { EncodedHashParts } from './password.service.types';

/** The algorithm tag that identifies the encoded hash scheme. */
const ALGORITHM = 'scrypt';

/** The `$`-separated field count of a well-formed encoded hash string. */
const ENCODED_FIELD_COUNT = 6;

/**
 * Promise wrapper over `crypto.scrypt`. Rejects if the parameters are invalid
 * (e.g. a non-power-of-two `N`, a zero `keylen`, or a cost that exceeds the
 * memory limit); callers that verify untrusted stored hashes treat a rejection
 * as a failed verification rather than propagating it.
 */
function deriveKey(
  plaintext: string,
  salt: Buffer,
  keylen: number,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem is scaled to the cost parameters so the default 32 MiB ceiling
    // does not reject legitimately-sized derivations.
    const maxmem = 128 * N * r * 2 + 1024 * 1024;
    scrypt(plaintext, salt, keylen, { N, r, p, maxmem }, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/**
 * Pure: format the algorithm tag, cost parameters, salt, and derived key into
 * the self-describing `scrypt$<N>$<r>$<p>$<saltBase64>$<derivedKeyBase64>`
 * string stored in `User.passwordHash`.
 */
export function encodeHash(parts: EncodedHashParts): string {
  const saltB64 = parts.salt.toString('base64');
  const keyB64 = parts.derivedKey.toString('base64');
  return `${parts.algorithm}$${parts.N}$${parts.r}$${parts.p}$${saltB64}$${keyB64}`;
}

/**
 * Pure: parse a self-describing encoded hash string back into its parts, or
 * return `null` when the string is malformed (wrong field count, wrong
 * algorithm tag, non-integer or non-positive cost parameters, or unparseable
 * base64). Never throws.
 */
export function decodeHash(encoded: string | null | undefined): EncodedHashParts | null {
  if (typeof encoded !== 'string') {
    return null;
  }

  const fields = encoded.split('$');
  if (fields.length !== ENCODED_FIELD_COUNT) {
    return null;
  }

  const [algorithm, nRaw, rRaw, pRaw, saltB64, keyB64] = fields;
  if (algorithm !== ALGORITHM) {
    return null;
  }

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N <= 0 ||
    r <= 0 ||
    p <= 0
  ) {
    return null;
  }

  const salt = decodeBase64(saltB64);
  const derivedKey = decodeBase64(keyB64);
  if (salt === null || derivedKey === null || salt.length === 0 || derivedKey.length === 0) {
    return null;
  }

  return { algorithm, N, r, p, salt, derivedKey };
}

/**
 * Decode a base64 field, returning `null` when the input does not round-trip
 * (i.e. it was not valid base64). Guards `decodeHash` against silently
 * accepting corrupt salt/key fields.
 */
function decodeBase64(value: string): Buffer | null {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.toString('base64') !== normalizeBase64(value)) {
    return null;
  }
  return buffer;
}

/** Normalize base64 padding so a round-trip comparison is stable. */
function normalizeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('base64');
}

/**
 * Compute a salted, self-describing scrypt Password Hash for a plaintext
 * Password. A fresh random salt is generated per call, so two identical
 * plaintext Passwords produce different encoded hashes (Req 6.1). The plaintext
 * is never logged or returned.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derivedKey = await deriveKey(
    plaintext,
    salt,
    SCRYPT_KEYLEN,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
  );
  return encodeHash({
    algorithm: ALGORITHM,
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt,
    derivedKey,
  });
}

/**
 * Verify a candidate plaintext Password against a stored encoded Password Hash
 * in constant time with respect to the derived-key contents
 * (`crypto.timingSafeEqual`), without recovering the plaintext (Req 6.2, 6.3).
 * Returns `false` — rather than throwing — for a malformed or unparseable
 * stored hash, so a corrupt record cannot leak a stack trace or distinguish
 * itself from a wrong Password.
 */
export async function verifyPassword(
  plaintext: string,
  encodedHash: string | null | undefined,
): Promise<boolean> {
  const parts = decodeHash(encodedHash);
  if (parts === null) {
    return false;
  }

  try {
    const candidateKey = await deriveKey(
      plaintext,
      parts.salt,
      parts.derivedKey.length,
      parts.N,
      parts.r,
      parts.p,
    );
    // Equal length is guaranteed because candidateKey is derived with keylen =
    // parts.derivedKey.length; timingSafeEqual still requires it explicitly.
    if (candidateKey.length !== parts.derivedKey.length) {
      return false;
    }
    return timingSafeEqual(candidateKey, parts.derivedKey);
  } catch {
    return false;
  }
}
