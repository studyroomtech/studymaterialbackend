// Tests for the Study Material service (Req 5.1, 5.3, 5.4, 11.1–11.6).
//
// Covers upload (title 1–200, file present), edit (title 1–200, description
// 0–2000), delete, and get metadata, plus not-found handling for missing
// materials. The service is exercised over small in-memory fake repositories
// and a fake storage adapter (no Prisma, no R2), plus example checks and a
// property for the isolated pure helpers. Price handling and the entitlement
// gate are Phase 2 and are intentionally out of scope here.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildTagsByCategoryType,
  createMaterialService,
  isDescriptionWithinBounds,
  isFilePresent,
  isPaidMaterial,
  isTitleWithinBounds,
  normalizeDescription,
  normalizeTitle,
  toMaterialDto,
} from './material.service';
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../constants/limits.constant';
import { AppError } from '../utils/errors';
import type { StorageObjectBody } from '../storage/storage.types';
import type {
  MaterialRecord,
  MaterialServiceDeps,
  UploadedFile,
} from './material.service.types';

// --- In-memory fakes ------------------------------------------------------
//
// The fake repository and storage adapter are built inside `setup` as closures
// over plain arrays/maps so no local type/interface declaration is needed in
// this source file (the convention lint forbids `type`/`interface` outside
// `*.types.ts`).

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

function sampleFile(overrides?: Partial<UploadedFile>): UploadedFile {
  return {
    body: 'PDF-BYTES',
    fileName: 'notes.pdf',
    contentType: 'application/pdf',
    sizeBytes: 9,
    ...overrides,
  };
}

function setup(seed?: {
  materials?: MaterialRecord[];
  entitlements?: { userId: string; studyMaterialId: string }[];
}) {
  const store = {
    materials: seed?.materials ?? [],
    objects: new Map<string, StorageObjectBody>(),
    entitlements: seed?.entitlements ?? [],
  };
  const deleted: string[] = [];

  let keySeq = 0;

  const deps: MaterialServiceDeps = {
    materials: {
      async create(input) {
        const record: MaterialRecord = {
          id: nextId('mat'),
          title: input.title,
          description: input.description,
          objectKey: input.objectKey,
          fileName: input.fileName,
          contentType: input.contentType,
          fileSizeBytes: input.fileSizeBytes,
          priceAmount: input.priceAmount ?? null,
          currency: input.currency ?? 'INR',
          tags: [],
        };
        store.materials.push(record);
        return record;
      },
      async findById(id) {
        return store.materials.find((m) => m.id === id) ?? null;
      },
      async update(id, input) {
        const record = store.materials.find((m) => m.id === id)!;
        if (input.title !== undefined) {
          record.title = input.title;
        }
        if (input.description !== undefined) {
          record.description = input.description;
        }
        if (input.priceAmount !== undefined) {
          record.priceAmount = input.priceAmount;
        }
        if (input.currency !== undefined) {
          record.currency = input.currency;
        }
        return record;
      },
      async delete(id) {
        const index = store.materials.findIndex((m) => m.id === id);
        if (index >= 0) {
          store.materials.splice(index, 1);
        }
      },
    },
    storage: {
      async putObject(objectKey, body) {
        store.objects.set(objectKey, body);
      },
      async deleteObject(objectKey) {
        store.objects.delete(objectKey);
        deleted.push(objectKey);
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
    generateObjectKey: () => {
      keySeq += 1;
      return `materials/key_${keySeq}`;
    },
  };

  const service = createMaterialService(deps);
  return { store, deleted, service };
}

/** Assert that a promise rejects with an AppError carrying a given status. */
async function expectStatus(p: Promise<unknown>, statusCode: number) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((err: AppError) => {
    expect(err.statusCode).toBe(statusCode);
  });
}

// --- Pure helpers ---------------------------------------------------------

describe('pure helpers', () => {
  it('normalizeTitle trims and coalesces nullish', () => {
    expect(normalizeTitle('  Algebra  ')).toBe('Algebra');
    expect(normalizeTitle(null)).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
  });

  it('normalizeDescription trims and coalesces nullish to empty', () => {
    expect(normalizeDescription('  intro  ')).toBe('intro');
    expect(normalizeDescription(null)).toBe('');
    expect(normalizeDescription(undefined)).toBe('');
  });

  it('isTitleWithinBounds treats whitespace-only as empty', () => {
    expect(isTitleWithinBounds('   ')).toBe(false);
    expect(isTitleWithinBounds('a')).toBe(true);
    expect(isTitleWithinBounds('a'.repeat(TITLE_MAX_LENGTH))).toBe(true);
    expect(isTitleWithinBounds('a'.repeat(TITLE_MAX_LENGTH + 1))).toBe(false);
  });

  it('isDescriptionWithinBounds accepts empty and rejects overlong', () => {
    expect(isDescriptionWithinBounds('')).toBe(true);
    expect(isDescriptionWithinBounds('   ')).toBe(true);
    expect(isDescriptionWithinBounds('a'.repeat(DESCRIPTION_MAX_LENGTH))).toBe(
      true,
    );
    expect(
      isDescriptionWithinBounds('a'.repeat(DESCRIPTION_MAX_LENGTH + 1)),
    ).toBe(false);
  });

  it('isFilePresent detects a usable body', () => {
    expect(isFilePresent(null)).toBe(false);
    expect(isFilePresent(undefined)).toBe(false);
    expect(isFilePresent(sampleFile({ body: '' }))).toBe(false);
    expect(isFilePresent(sampleFile({ body: new Uint8Array(0) }))).toBe(false);
    expect(isFilePresent(sampleFile({ body: new Uint8Array(3) }))).toBe(true);
    expect(isFilePresent(sampleFile())).toBe(true);
  });

  it('buildTagsByCategoryType groups tags by Category Type id', () => {
    const record: MaterialRecord = {
      id: 'mat_1',
      title: 'T',
      description: '',
      objectKey: 'materials/k',
      fileName: 'f.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1,
      tags: [
        { categoryId: 'cat_math', categoryTypeId: 'ct_subject', name: 'Math' },
        { categoryId: 'cat_sci', categoryTypeId: 'ct_subject', name: 'Science' },
        { categoryId: 'cat_da', categoryTypeId: 'ct_job', name: 'Data Analyst' },
      ],
    };
    expect(buildTagsByCategoryType(record)).toEqual({
      ct_subject: [
        { categoryId: 'cat_math', name: 'Math' },
        { categoryId: 'cat_sci', name: 'Science' },
      ],
      ct_job: [{ categoryId: 'cat_da', name: 'Data Analyst' }],
    });
  });

  it('toMaterialDto never exposes the Object Storage Key and reflects a Free Price', () => {
    const record: MaterialRecord = {
      id: 'mat_1',
      title: 'Algebra',
      description: 'intro',
      objectKey: 'materials/secret-key',
      fileName: 'algebra.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 42,
      tags: [],
    };
    const dto = toMaterialDto(record);
    expect(dto).toEqual({
      id: 'mat_1',
      title: 'Algebra',
      description: 'intro',
      tagsByCategoryType: {},
      fileName: 'algebra.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 42,
      priceAmount: null,
      currency: 'INR',
      isPaid: false,
    });
    expect(JSON.stringify(dto)).not.toContain('secret-key');
  });

  it('toMaterialDto reflects a Paid Material Price', () => {
    const record: MaterialRecord = {
      id: 'mat_2',
      title: 'Premium Notes',
      description: 'premium',
      objectKey: 'materials/paid-key',
      fileName: 'premium.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 42,
      priceAmount: 500,
      currency: 'INR',
      tags: [],
    };
    const dto = toMaterialDto(record);
    expect(dto.priceAmount).toBe(500);
    expect(dto.currency).toBe('INR');
    expect(dto.isPaid).toBe(true);
  });

  it('property: titles within [1,200] after trimming are accepted, others rejected', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 260 }), (raw) => {
        const trimmedLen = raw.trim().length;
        const expected = trimmedLen >= 1 && trimmedLen <= TITLE_MAX_LENGTH;
        expect(isTitleWithinBounds(raw)).toBe(expected);
      }),
    );
  });
});

// --- Upload ---------------------------------------------------------------

describe('uploadMaterial', () => {
  it('stores bytes in R2 and persists metadata for a valid upload', async () => {
    const { service, store } = setup();
    const dto = await service.uploadMaterial({
      title: '  Algebra Notes  ',
      description: '  intro  ',
      file: sampleFile(),
    });
    expect(dto.title).toBe('Algebra Notes');
    expect(dto.description).toBe('intro');
    expect(dto.fileName).toBe('notes.pdf');
    expect(store.materials).toHaveLength(1);
    expect(store.objects.size).toBe(1);
    // The Object Storage Key is stored but never surfaced on the DTO.
    expect(dto).not.toHaveProperty('objectKey');
  });

  it('defaults an omitted description to an empty string', async () => {
    const { service } = setup();
    const dto = await service.uploadMaterial({
      title: 'Algebra',
      file: sampleFile(),
    });
    expect(dto.description).toBe('');
  });

  it('rejects an empty title and stores nothing in DB or R2', async () => {
    const { service, store } = setup();
    await expectStatus(
      service.uploadMaterial({ title: '   ', file: sampleFile() }),
      422,
    );
    expect(store.materials).toHaveLength(0);
    expect(store.objects.size).toBe(0);
  });

  it('rejects a title exceeding 200 characters', async () => {
    const { service, store } = setup();
    await expectStatus(
      service.uploadMaterial({
        title: 'a'.repeat(TITLE_MAX_LENGTH + 1),
        file: sampleFile(),
      }),
      422,
    );
    expect(store.materials).toHaveLength(0);
    expect(store.objects.size).toBe(0);
  });

  it('rejects a description exceeding 2000 characters', async () => {
    const { service, store } = setup();
    await expectStatus(
      service.uploadMaterial({
        title: 'Algebra',
        description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1),
        file: sampleFile(),
      }),
      422,
    );
    expect(store.materials).toHaveLength(0);
    expect(store.objects.size).toBe(0);
  });

  it('rejects an upload with no file present, storing nothing', async () => {
    const { service, store } = setup();
    await expectStatus(
      service.uploadMaterial({
        title: 'Algebra',
        file: sampleFile({ body: '' }),
      }),
      422,
    );
    expect(store.materials).toHaveLength(0);
    expect(store.objects.size).toBe(0);
  });

  // --- Price handling (Req 11.13, 11.14, 11.15) --------------------------

  it('persists a valid Paid Material Price and marks it Paid (Req 11.13)', async () => {
    const { service, store } = setup();
    const dto = await service.uploadMaterial({
      title: 'Premium Notes',
      priceAmount: 500,
      currency: 'INR',
      file: sampleFile(),
    });
    expect(dto.priceAmount).toBe(500);
    expect(dto.currency).toBe('INR');
    expect(dto.isPaid).toBe(true);
    expect(store.materials[0].priceAmount).toBe(500);
  });

  it('defaults the Currency to INR when a Paid Price omits it (Req 11.13)', async () => {
    const { service } = setup();
    const dto = await service.uploadMaterial({
      title: 'Premium Notes',
      priceAmount: 750,
      file: sampleFile(),
    });
    expect(dto.priceAmount).toBe(750);
    expect(dto.currency).toBe('INR');
    expect(dto.isPaid).toBe(true);
  });

  it('treats an omitted or zero Price as a Free Material (Req 11.14)', async () => {
    const { service } = setup();
    const free = await service.uploadMaterial({
      title: 'Free Notes',
      file: sampleFile(),
    });
    expect(free.priceAmount).toBeNull();
    expect(free.isPaid).toBe(false);

    const zero = await service.uploadMaterial({
      title: 'Zero Notes',
      priceAmount: 0,
      file: sampleFile(),
    });
    expect(zero.priceAmount).toBeNull();
    expect(zero.isPaid).toBe(false);
  });

  it('rejects an out-of-range, non-integer, or non-INR Price, storing nothing (Req 11.15)', async () => {
    for (const bad of [
      { priceAmount: -1 },
      { priceAmount: 1000001 },
      { priceAmount: 10.5 },
      { priceAmount: 500, currency: 'USD' },
    ] as const) {
      const { service, store } = setup();
      await expectStatus(
        service.uploadMaterial({
          title: 'Premium Notes',
          file: sampleFile(),
          ...bad,
        }),
        422,
      );
      expect(store.materials).toHaveLength(0);
      expect(store.objects.size).toBe(0);
    }
  });
});

// --- Edit -----------------------------------------------------------------

describe('editMaterial', () => {
  function seeded() {
    return setup({
      materials: [
        {
          id: 'mat_1',
          title: 'Algebra',
          description: 'intro',
          objectKey: 'materials/k1',
          fileName: 'algebra.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 10,
          tags: [],
        },
      ],
    });
  }

  it('updates the title and description within bounds', async () => {
    const { service, store } = seeded();
    const dto = await service.editMaterial('mat_1', {
      title: '  Advanced Algebra  ',
      description: 'deeper intro',
    });
    expect(dto.title).toBe('Advanced Algebra');
    expect(dto.description).toBe('deeper intro');
    expect(store.materials[0].title).toBe('Advanced Algebra');
  });

  it('leaves omitted fields unchanged', async () => {
    const { service, store } = seeded();
    await service.editMaterial('mat_1', { description: 'new desc' });
    expect(store.materials[0].title).toBe('Algebra');
    expect(store.materials[0].description).toBe('new desc');
  });

  it('allows clearing the description to empty', async () => {
    const { service, store } = seeded();
    const dto = await service.editMaterial('mat_1', { description: '' });
    expect(dto.description).toBe('');
    expect(store.materials[0].description).toBe('');
  });

  it('rejects an empty title, leaving metadata unchanged', async () => {
    const { service, store } = seeded();
    await expectStatus(service.editMaterial('mat_1', { title: '  ' }), 422);
    expect(store.materials[0].title).toBe('Algebra');
  });

  it('rejects an out-of-bounds title/description, leaving metadata unchanged', async () => {
    const { service, store } = seeded();
    await expectStatus(
      service.editMaterial('mat_1', {
        title: 'a'.repeat(TITLE_MAX_LENGTH + 1),
      }),
      422,
    );
    await expectStatus(
      service.editMaterial('mat_1', {
        description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1),
      }),
      422,
    );
    expect(store.materials[0].title).toBe('Algebra');
    expect(store.materials[0].description).toBe('intro');
  });

  it('returns not-found when editing a missing material', async () => {
    const { service } = setup();
    await expectStatus(service.editMaterial('missing', { title: 'X' }), 404);
  });

  // --- Price handling (Req 11.13, 11.14, 11.15) --------------------------

  it('sets a valid Paid Material Price on edit (Req 11.13)', async () => {
    const { service, store } = seeded();
    const dto = await service.editMaterial('mat_1', {
      priceAmount: 500,
      currency: 'INR',
    });
    expect(dto.priceAmount).toBe(500);
    expect(dto.isPaid).toBe(true);
    expect(store.materials[0].priceAmount).toBe(500);
    // Other metadata is untouched.
    expect(store.materials[0].title).toBe('Algebra');
  });

  it('clears a Price to Free when edited to 0 (Req 11.14)', async () => {
    const { service, store } = setup({
      materials: [
        {
          id: 'mat_1',
          title: 'Premium',
          description: '',
          objectKey: 'materials/k1',
          fileName: 'p.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 10,
          priceAmount: 500,
          currency: 'INR',
          tags: [],
        },
      ],
    });
    const dto = await service.editMaterial('mat_1', { priceAmount: 0 });
    expect(dto.priceAmount).toBeNull();
    expect(dto.isPaid).toBe(false);
    expect(store.materials[0].priceAmount).toBeNull();
  });

  it('rejects an invalid Price on edit, leaving metadata and Price unchanged (Req 11.15)', async () => {
    const { service, store } = setup({
      materials: [
        {
          id: 'mat_1',
          title: 'Premium',
          description: 'intro',
          objectKey: 'materials/k1',
          fileName: 'p.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 10,
          priceAmount: 500,
          currency: 'INR',
          tags: [],
        },
      ],
    });
    await expectStatus(service.editMaterial('mat_1', { priceAmount: 1000001 }), 422);
    await expectStatus(
      service.editMaterial('mat_1', { priceAmount: 500, currency: 'USD' }),
      422,
    );
    expect(store.materials[0].priceAmount).toBe(500);
    expect(store.materials[0].title).toBe('Premium');
    expect(store.materials[0].description).toBe('intro');
  });

  it('leaves the Price unchanged when priceAmount is omitted (Req 11.5)', async () => {
    const { service, store } = setup({
      materials: [
        {
          id: 'mat_1',
          title: 'Premium',
          description: 'intro',
          objectKey: 'materials/k1',
          fileName: 'p.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 10,
          priceAmount: 500,
          currency: 'INR',
          tags: [],
        },
      ],
    });
    await service.editMaterial('mat_1', { title: 'Premium Renamed' });
    expect(store.materials[0].priceAmount).toBe(500);
  });
});

// --- Delete ---------------------------------------------------------------

describe('deleteMaterial', () => {
  it('removes the metadata and the R2 object for an existing material', async () => {
    const { service, store, deleted } = setup({
      materials: [
        {
          id: 'mat_1',
          title: 'Algebra',
          description: '',
          objectKey: 'materials/k1',
          fileName: 'algebra.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 10,
          tags: [],
        },
      ],
    });
    await service.deleteMaterial('mat_1');
    expect(store.materials).toHaveLength(0);
    expect(deleted).toContain('materials/k1');
  });

  it('returns not-found when deleting a missing material, changing nothing', async () => {
    const { service, deleted } = setup();
    await expectStatus(service.deleteMaterial('missing'), 404);
    expect(deleted).toHaveLength(0);
  });
});

// --- Get ------------------------------------------------------------------

describe('getMaterial', () => {
  it('returns the complete metadata for an existing material', async () => {
    const { service } = setup({
      materials: [
        {
          id: 'mat_1',
          title: 'Algebra',
          description: 'intro',
          objectKey: 'materials/k1',
          fileName: 'algebra.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 10,
          tags: [
            {
              categoryId: 'cat_math',
              categoryTypeId: 'ct_subject',
              name: 'Math',
            },
          ],
        },
      ],
    });
    const dto = await service.getMaterial('mat_1');
    expect(dto.id).toBe('mat_1');
    expect(dto.title).toBe('Algebra');
    expect(dto.tagsByCategoryType).toEqual({
      ct_subject: [{ categoryId: 'cat_math', name: 'Math' }],
    });
  });

  it('returns not-found without content for a missing material', async () => {
    const { service } = setup();
    await expectStatus(service.getMaterial('missing'), 404);
  });
});

// --- Entitlement gate (Req 12.2, 12.3) ------------------------------------

describe('isPaidMaterial', () => {
  it('classifies a strictly-positive amount as Paid and null/0 as Free', () => {
    expect(isPaidMaterial(100)).toBe(true);
    expect(isPaidMaterial(1)).toBe(true);
    expect(isPaidMaterial(0)).toBe(false);
    expect(isPaidMaterial(null)).toBe(false);
    expect(isPaidMaterial(undefined)).toBe(false);
  });
});

describe('getMaterial entitlement gate', () => {
  function paidMaterial(): MaterialRecord {
    return {
      id: 'mat_paid',
      title: 'Paid Notes',
      description: 'premium',
      objectKey: 'materials/paid-key',
      fileName: 'paid.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 20,
      priceAmount: 500,
      tags: [],
    };
  }

  it('returns content for a Paid Material when the learner is entitled', async () => {
    const { service } = setup({
      materials: [paidMaterial()],
      entitlements: [{ userId: 'user_1', studyMaterialId: 'mat_paid' }],
    });
    const dto = await service.getMaterial('mat_paid', 'user_1');
    expect(dto.id).toBe('mat_paid');
    expect(dto.title).toBe('Paid Notes');
  });

  it('returns 403 PAYMENT_REQUIRED and no content when the learner is not entitled', async () => {
    const { service } = setup({ materials: [paidMaterial()] });
    await expectStatus(service.getMaterial('mat_paid', 'user_1'), 403);
  });

  it('returns 403 PAYMENT_REQUIRED when no learner is resolved for a Paid Material', async () => {
    const { service } = setup({ materials: [paidMaterial()] });
    await expectStatus(service.getMaterial('mat_paid'), 403);
    await expectStatus(service.getMaterial('mat_paid', null), 403);
  });

  it('does not honor an Entitlement granted for a different material', async () => {
    const { service } = setup({
      materials: [paidMaterial()],
      entitlements: [{ userId: 'user_1', studyMaterialId: 'mat_other' }],
    });
    await expectStatus(service.getMaterial('mat_paid', 'user_1'), 403);
  });

  it('serves a Free Material without any entitlement check', async () => {
    const { service } = setup({
      materials: [
        {
          id: 'mat_free',
          title: 'Free Notes',
          description: '',
          objectKey: 'materials/free-key',
          fileName: 'free.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 10,
          priceAmount: null,
          tags: [],
        },
      ],
    });
    // No userId and no entitlements: a Free Material is still returned.
    const dto = await service.getMaterial('mat_free');
    expect(dto.id).toBe('mat_free');
  });
});
