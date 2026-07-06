// Tests for the Download Gate / download service (Req 6.2–6.6, 6.8, 6.9,
// 9.1–9.4).
//
// Covers the pure name/email validators plus the two service operations
// (Download Gate submission and tracked download) exercised over small
// in-memory fakes (no Prisma, JWT, or R2). Includes example/unit checks and the
// design's numbered properties:
//   - Property 12: Download Gate validation decision (Req 6.2, 6.3)
//   - Property 13: Download Gate is idempotent on email (Req 6.4)
//   - Property 15: Successful downloads produce one accurate Download Record
//     each with a valid ISO 8601 timestamp (Req 9.1, 9.2, 9.3)

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createDownloadService,
  isEmailValid,
  isNameValid,
  normalizeEmail,
  normalizeName,
  validateGateSubmission,
} from './download.service';
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  ACCESS_TOKEN_TTL_SECONDS,
} from '../constants/limits.constant';
import { EMAIL_FORMAT_PATTERN } from './download.service.constant';
import { AppError } from '../utils/errors';
import type { AccessTokenClaims } from '../types/auth.types';
import type {
  DownloadMaterialRecord,
  DownloadRecord,
  DownloadServiceDeps,
  DownloadUserRecord,
} from './download.service.types';

// --- In-memory fakes ------------------------------------------------------
//
// The fake collaborators are built inside `setup` as closures over plain arrays
// so no local type/interface declaration is needed in this source file (the
// convention lint forbids `type`/`interface` outside `*.types.ts`).

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function setup(seed?: {
  users?: DownloadUserRecord[];
  materials?: DownloadMaterialRecord[];
  entitlements?: { userId: string; studyMaterialId: string }[];
  failCreateDownload?: boolean;
}) {
  const store = {
    users: seed?.users ?? [],
    materials: seed?.materials ?? [],
    entitlements: seed?.entitlements ?? [],
    downloads: [] as DownloadRecord[],
  };

  // A trivial reversible "token" for tests: encode the learner claims as JSON.
  const issuedTokens: string[] = [];

  const deps: DownloadServiceDeps = {
    users: {
      async upsertUserByEmail(email, name) {
        const existing = store.users.find((u) => u.email === email);
        if (existing !== undefined) {
          return existing;
        }
        const record = { id: nextId('user'), email };
        store.users.push(record);
        // `name` is accepted by the contract but not surfaced in the minimal
        // record used by the service; touch it to model persistence.
        void name;
        return record;
      },
      async findUserById(id) {
        return store.users.find((u) => u.id === id) ?? null;
      },
    },
    materials: {
      async findMaterialById(id) {
        return store.materials.find((m) => m.id === id) ?? null;
      },
    },
    downloads: {
      async createDownload(userId, studyMaterialId) {
        if (seed?.failCreateDownload === true) {
          throw new Error('simulated persistence failure');
        }
        const record: DownloadRecord = {
          id: nextId('dl'),
          userId,
          studyMaterialId,
          downloadedAt: new Date(),
        };
        store.downloads.push(record);
        return record;
      },
    },
    entitlements: {
      async findEntitlement(userId, studyMaterialId) {
        return (
          store.entitlements.find(
            (e) =>
              e.userId === userId && e.studyMaterialId === studyMaterialId,
          ) ?? null
        );
      },
    },
    issueLearnerToken(userId, email) {
      const token = JSON.stringify({ sub: userId, role: 'role_common', email });
      issuedTokens.push(token);
      return token;
    },
    verifyToken(token) {
      try {
        const parsed = JSON.parse(token) as AccessTokenClaims;
        if (typeof parsed.sub !== 'string' || parsed.role === undefined) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    async getPresignedDownloadUrl(objectKey, fileName) {
      return `https://r2.example/${objectKey}?fn=${encodeURIComponent(
        fileName ?? '',
      )}`;
    },
    async getPresignedPreviewUrl(objectKey, fileName, contentType) {
      return `https://r2.example/${objectKey}?fn=${encodeURIComponent(
        fileName ?? '',
      )}&ct=${encodeURIComponent(contentType ?? '')}&inline=1`;
    },
    presignedUrlTtlSeconds: 900,
  };

  const service = createDownloadService(deps);
  return { store, service, issuedTokens };
}

/** Assert that a promise rejects with an AppError carrying a given status. */
async function expectStatus(p: Promise<unknown>, statusCode: number) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((err: AppError) => {
    expect(err.statusCode).toBe(statusCode);
  });
}

// --- Pure validators ------------------------------------------------------

describe('pure validators', () => {
  it('normalizeName / normalizeEmail trim and coalesce nullish', () => {
    expect(normalizeName('  Ada  ')).toBe('Ada');
    expect(normalizeName(null)).toBe('');
    expect(normalizeEmail('  ada@example.com ')).toBe('ada@example.com');
    expect(normalizeEmail(undefined)).toBe('');
  });

  it('isNameValid enforces the 1–100 bound after trimming', () => {
    expect(isNameValid('   ')).toBe(false);
    expect(isNameValid('A')).toBe(true);
    expect(isNameValid('a'.repeat(NAME_MAX_LENGTH))).toBe(true);
    expect(isNameValid('a'.repeat(NAME_MAX_LENGTH + 1))).toBe(false);
  });

  it('isEmailValid enforces length and format', () => {
    expect(isEmailValid('ada@example.com')).toBe(true);
    expect(isEmailValid('')).toBe(false);
    expect(isEmailValid('not-an-email')).toBe(false);
    expect(isEmailValid('missing@domain')).toBe(false);
    expect(isEmailValid('a b@example.com')).toBe(false);
    // Over the 254-char bound with an otherwise valid shape.
    const longLocal = 'a'.repeat(EMAIL_MAX_LENGTH);
    expect(isEmailValid(`${longLocal}@example.com`)).toBe(false);
  });

  it('validateGateSubmission returns normalized values on success', () => {
    expect(validateGateSubmission('  Ada  ', ' ada@example.com ')).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
    });
  });

  it('validateGateSubmission reports each invalid field', () => {
    try {
      validateGateSubmission('', 'bad');
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const fields = (err as AppError).fields ?? [];
      const names = fields.map((f) => f.field).sort();
      expect(names).toEqual(['email', 'name']);
    }
  });
});

// --- Download Gate submission ---------------------------------------------

describe('submitGate', () => {
  it('validates, upserts a user, and issues a token with 2592000s expiry', async () => {
    const { service, store } = setup();
    const result = await service.submitGate('Ada Lovelace', 'ada@example.com');
    expect(store.users).toHaveLength(1);
    expect(store.users[0].email).toBe('ada@example.com');
    expect(result.expiresInSeconds).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(result.userId).toBe(store.users[0].id);
    expect(typeof result.accessToken).toBe('string');
  });

  it('rejects invalid submissions with a 422 and persists no user', async () => {
    const { service, store } = setup();
    await expectStatus(service.submitGate('', 'nope'), 422);
    expect(store.users).toHaveLength(0);
  });
});

// --- prepareDownload ------------------------------------------------------

describe('prepareDownload', () => {
  function seeded() {
    return setup({
      users: [{ id: 'user_1', email: 'ada@example.com' }],
      materials: [
        { id: 'mat_1', objectKey: 'obj/mat_1.pdf', fileName: 'notes.pdf' },
      ],
    });
  }

  function learnerToken(userId: string, email: string): string {
    return JSON.stringify({ sub: userId, role: 'role_common', email });
  }

  it('resolves the learner, presigns, and records the download', async () => {
    const { service, store } = seeded();
    const result = await service.prepareDownload(
      learnerToken('user_1', 'ada@example.com'),
      'mat_1',
    );
    expect(result.fileName).toBe('notes.pdf');
    expect(result.downloadUrl).toContain('obj/mat_1.pdf');
    expect(result.expiresInSeconds).toBe(900);
    expect(store.downloads).toHaveLength(1);
    expect(store.downloads[0]).toMatchObject({
      userId: 'user_1',
      studyMaterialId: 'mat_1',
    });
  });

  it('rejects a missing/invalid token with 401 (re-prompt Download Gate)', async () => {
    const { service, store } = seeded();
    await expectStatus(service.prepareDownload('garbage', 'mat_1'), 401);
    expect(store.downloads).toHaveLength(0);
  });

  it('rejects an admin token (no User Record) with 401', async () => {
    const { service } = seeded();
    const adminToken = JSON.stringify({
      sub: 'admin_1',
      role: 'role_admin',
      username: 'root',
    });
    await expectStatus(service.prepareDownload(adminToken, 'mat_1'), 401);
  });

  it('rejects a token whose user no longer resolves with 401', async () => {
    const { service } = seeded();
    await expectStatus(
      service.prepareDownload(learnerToken('ghost', 'x@example.com'), 'mat_1'),
      401,
    );
  });

  it('returns 404 for a missing Study Material and records nothing', async () => {
    const { service, store } = seeded();
    await expectStatus(
      service.prepareDownload(learnerToken('user_1', 'ada@example.com'), 'missing'),
      404,
    );
    expect(store.downloads).toHaveLength(0);
  });

  it('logs and surfaces a 500 when the Download Record cannot be persisted', async () => {
    const { service } = setup({
      users: [{ id: 'user_1', email: 'ada@example.com' }],
      materials: [
        { id: 'mat_1', objectKey: 'obj/mat_1.pdf', fileName: 'notes.pdf' },
      ],
      failCreateDownload: true,
    });
    await expectStatus(
      service.prepareDownload(learnerToken('user_1', 'ada@example.com'), 'mat_1'),
      500,
    );
  });
});

// --- Paid-Material entitlement gate (Req 12.2, 12.3) ----------------------

describe('prepareDownload entitlement gate', () => {
  function learnerToken(userId: string, email: string): string {
    return JSON.stringify({ sub: userId, role: 'role_common', email });
  }

  function seededPaid(entitled: boolean) {
    return setup({
      users: [{ id: 'user_1', email: 'ada@example.com' }],
      materials: [
        {
          id: 'mat_paid',
          objectKey: 'obj/mat_paid.pdf',
          fileName: 'paid.pdf',
          priceAmount: 500,
        },
      ],
      entitlements: entitled
        ? [{ userId: 'user_1', studyMaterialId: 'mat_paid' }]
        : [],
    });
  }

  it('presigns and records the download for an entitled learner', async () => {
    const { service, store } = seededPaid(true);
    const result = await service.prepareDownload(
      learnerToken('user_1', 'ada@example.com'),
      'mat_paid',
    );
    expect(result.fileName).toBe('paid.pdf');
    expect(store.downloads).toHaveLength(1);
  });

  it('returns 403 PAYMENT_REQUIRED with no presign and no Download Record when not entitled', async () => {
    const { service, store } = seededPaid(false);
    await expectStatus(
      service.prepareDownload(
        learnerToken('user_1', 'ada@example.com'),
        'mat_paid',
      ),
      403,
    );
    expect(store.downloads).toHaveLength(0);
  });

  it('does not honor an Entitlement granted for a different material', async () => {
    const { service, store } = setup({
      users: [{ id: 'user_1', email: 'ada@example.com' }],
      materials: [
        {
          id: 'mat_paid',
          objectKey: 'obj/mat_paid.pdf',
          fileName: 'paid.pdf',
          priceAmount: 500,
        },
      ],
      entitlements: [{ userId: 'user_1', studyMaterialId: 'mat_other' }],
    });
    await expectStatus(
      service.prepareDownload(
        learnerToken('user_1', 'ada@example.com'),
        'mat_paid',
      ),
      403,
    );
    expect(store.downloads).toHaveLength(0);
  });

  it('lets a Free Material download proceed without an entitlement check', async () => {
    const { service, store } = setup({
      users: [{ id: 'user_1', email: 'ada@example.com' }],
      materials: [
        {
          id: 'mat_free',
          objectKey: 'obj/mat_free.pdf',
          fileName: 'free.pdf',
          priceAmount: 0,
        },
      ],
    });
    const result = await service.prepareDownload(
      learnerToken('user_1', 'ada@example.com'),
      'mat_free',
    );
    expect(result.fileName).toBe('free.pdf');
    expect(store.downloads).toHaveLength(1);
  });
});

// --- Property 12: Download Gate validation decision -----------------------

describe('Property 12: Download Gate validation decision', () => {
  // Validates: Requirements 6.2, 6.3
  it('accepts iff name is 1–100 chars and email is 1–254 chars in valid format', () => {
    fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 130 }),
        fc.string({ maxLength: 300 }),
        async (rawName, rawEmail) => {
          const name = rawName.trim();
          const email = rawEmail.trim();
          const expected =
            name.length >= 1 &&
            name.length <= NAME_MAX_LENGTH &&
            email.length >= 1 &&
            email.length <= EMAIL_MAX_LENGTH &&
            EMAIL_FORMAT_PATTERN.test(email);

          const { store, service } = setup();

          if (expected) {
            const result = await service.submitGate(rawName, rawEmail);
            expect(typeof result.accessToken).toBe('string');
            expect(store.users).toHaveLength(1);
            return;
          }
          await service.submitGate(rawName, rawEmail).then(
            () => {
              throw new Error('expected rejection for invalid submission');
            },
            (err) => {
              expect(err).toBeInstanceOf(AppError);
              expect((err as AppError).statusCode).toBe(422);
              // No User Record persisted on rejection (Req 6.3).
              expect(store.users).toHaveLength(0);
            },
          );
        },
      ),
    );
  });

  it('generated valid submissions are always accepted', () => {
    // Bias generation toward valid inputs to exercise the accept branch.
    const validName = fc
      .string({ minLength: 1, maxLength: NAME_MAX_LENGTH })
      .filter((s) => s.trim().length >= 1 && s.trim().length <= NAME_MAX_LENGTH);
    const validEmail = fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{2,4}$/),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    fc.assert(
      fc.property(validName, validEmail, (name, email) => {
        expect(isNameValid(name)).toBe(true);
        expect(isEmailValid(email)).toBe(true);
        expect(() => validateGateSubmission(name, email)).not.toThrow();
      }),
    );
  });
});

// --- Property 13: Download Gate is idempotent on email --------------------

describe('Property 13: Download Gate is idempotent on email', () => {
  // Validates: Requirements 6.4
  it('repeated submissions with the same email yield exactly one User Record', () => {
    const validEmail = fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{2,4}$/),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    fc.assert(
      fc.asyncProperty(
        validEmail,
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (email, names) => {
          const { store, service } = setup();
          // Submit the gate repeatedly with the same email (names may vary).
          for (const raw of names) {
            const name = raw.trim().length >= 1 ? raw : 'Learner';
             
            await service.submitGate(name, email);
          }
          const matching = store.users.filter((u) => u.email === email);
          expect(matching).toHaveLength(1);
        },
      ),
    );
  });
});

// --- Property 15: Successful downloads produce one accurate record each ----

describe('Property 15: successful downloads produce one accurate Download Record each', () => {
  // Validates: Requirements 9.1, 9.2, 9.3
  it('N successful downloads persist exactly N accurate ISO 8601 records', () => {
    const idArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);

    fc.assert(
      fc.asyncProperty(
        // A set of learners and materials, and a sequence of (learner, material)
        // download requests referencing them.
        fc.uniqueArray(idArb, { minLength: 1, maxLength: 4 }),
        fc.uniqueArray(idArb, { minLength: 1, maxLength: 4 }),
        fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 1, maxLength: 12 }),
        async (userIds, materialIds, rawRequests) => {
          const users: DownloadUserRecord[] = userIds.map((id) => ({
            id: `user_${id}`,
            email: `${id}@example.com`,
          }));
          const materials: DownloadMaterialRecord[] = materialIds.map((id) => ({
            id: `mat_${id}`,
            objectKey: `obj/${id}.pdf`,
            fileName: `${id}.pdf`,
          }));
          const { store, service } = setup({ users, materials });

          const requests = rawRequests.map(([u, m]) => ({
            user: users[u % users.length],
            material: materials[m % materials.length],
          }));

          for (const req of requests) {
            const token = JSON.stringify({
              sub: req.user.id,
              role: 'role_common',
              email: req.user.email,
            });
             
            await service.prepareDownload(token, req.material.id);
          }

          // Exactly N records (Req 9.3), each referencing the correct user and
          // material (Req 9.1) with a valid ISO 8601 timestamp (Req 9.2).
          expect(store.downloads).toHaveLength(requests.length);
          store.downloads.forEach((record, index) => {
            expect(record.userId).toBe(requests[index].user.id);
            expect(record.studyMaterialId).toBe(requests[index].material.id);
            expect(ISO_8601_PATTERN.test(record.downloadedAt.toISOString())).toBe(
              true,
            );
          });
        },
      ),
    );
  });
});
