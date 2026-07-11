// Types for the Password Hasher (Req 1.15: type/interface declarations live
// only in `*.types.ts`).
//
// The Password Hasher stores each Password Hash as a single self-describing
// string so its scrypt cost parameters can evolve without a schema change:
//
//   scrypt$<N>$<r>$<p>$<saltBase64>$<derivedKeyBase64>
//
// `encodeHash` formats these parts into that string and `decodeHash` parses a
// stored string back into them, so the salt and cost parameters used to derive
// a Password Hash are recovered at verification time (Req 6.1).

/**
 * The decoded components of a self-describing scrypt Password Hash. Together
 * they carry everything `verifyPassword` needs to recompute the derived key for
 * a candidate Password: the cost parameters (`N`, `r`, `p`), the per-Password
 * `salt`, and the previously derived key to compare against.
 */
export interface EncodedHashParts {
  /** The algorithm tag identifying the hashing scheme (e.g. `"scrypt"`). */
  algorithm: string;
  /** scrypt CPU/memory cost parameter (must be a power of two). */
  N: number;
  /** scrypt block-size parameter. */
  r: number;
  /** scrypt parallelization parameter. */
  p: number;
  /** The per-Password random salt bytes. */
  salt: Buffer;
  /** The derived-key (hash output) bytes. */
  derivedKey: Buffer;
}
