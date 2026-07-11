// Constant values for the Password Hasher.
//
// Per the project conventions (Requirements 1.16, 1.17), all constant values
// live in a `*.constant.ts` file. This module defines the scrypt cost
// parameters used to derive and verify one-way salted Password Hashes and a
// precomputed DUMMY_PASSWORD_HASH used by the Account Service as a timing
// equalizer on the no-stored-hash login paths.
//
// References:
//   - Req 6.1: One-way salted hashing with a unique salt per Password.
//   - Req 4.1: Cost parameters kept well under the 2000 ms sign-in budget.

/**
 * scrypt CPU/memory cost parameter (N). Must be a power of two; 16384 (2^14)
 * is memory-hard while completing well within the sign-in latency budget
 * (Req 4.1).
 */
export const SCRYPT_N = 16384;

/** scrypt block-size parameter (r). */
export const SCRYPT_R = 8;

/** scrypt parallelization parameter (p). */
export const SCRYPT_P = 1;

/** Length in bytes of the derived key produced by scrypt. */
export const SCRYPT_KEYLEN = 32;

/**
 * Number of random bytes generated per Password for the scrypt salt, so two
 * identical plaintext Passwords produce different Password Hashes (Req 6.1).
 */
export const SCRYPT_SALT_BYTES = 16;

/**
 * A precomputed, self-describing scrypt Password Hash of a random throwaway
 * constant, encoded as `scrypt$<N>$<r>$<p>$<saltBase64>$<derivedKeyBase64>`
 * with the same parameters above (N=16384, r=8, p=1, keylen=32, 16-byte salt).
 *
 * It exists purely as a timing equalizer: on login paths where no real
 * Password Hash is stored (non-existent email, or an Unprotected Account that
 * was nonetheless supplied a Password), the Account Service verifies against
 * this dummy hash so those attempts take comparable time to a real
 * verification, resisting account enumeration by timing (Req 4.1, 7.5). It is
 * never a valid credential for any account.
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$i0bdY2cJbRHgQgRIMD43bg==$GV3aq9o2qVmloEob6ynxdYg3TJ7G3BODndD9/6+Q2kE=';
