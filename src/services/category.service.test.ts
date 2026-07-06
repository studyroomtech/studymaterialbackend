// Tests for the Category management service (Req 2.1–2.4, 11.7–11.11).
//
// Covers Category Type / Category create/rename/delete with 1–100 char and
// scoped-uniqueness validation, and Tag assign/remove enforcing the 50-Tag
// limit and supported-Category-Type membership. The service is exercised over
// small in-memory fake repositories (no Prisma), plus example checks and a
// property for the isolated pure helpers.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createCategoryService,
  isNameWithinBounds,
  normalizeName,
  wouldExceedTagLimit,
} from './category.service';
import { MAX_TAGS_PER_MATERIAL } from '../constants/limits.constant';
import { AppError } from '../utils/errors';
import type {
  CategoryRecord,
  CategoryServiceDeps,
  CategoryTypeRecord,
  TagRecord,
} from './category.service.types';

// --- In-memory fakes ------------------------------------------------------
//
// The fake repositories are built inside `setup` as closures over plain arrays
// so no local type/interface declaration is needed in this source file (the
// convention lint forbids `type`/`interface` outside `*.types.ts`). Delete
// operations splice in place so the returned `store` reference stays stable.

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

function removeWhere<T>(arr: T[], pred: (item: T) => boolean): void {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i])) {
      arr.splice(i, 1);
    }
  }
}

function setup(seed?: {
  categoryTypes?: CategoryTypeRecord[];
  categories?: CategoryRecord[];
  materials?: { id: string }[];
  tags?: TagRecord[];
}) {
  const store = {
    categoryTypes: seed?.categoryTypes ?? [],
    categories: seed?.categories ?? [],
    materials: seed?.materials ?? [],
    tags: seed?.tags ?? [],
  };

  const deps: CategoryServiceDeps = {
    categories: {
      async findCategoryTypeById(id) {
        return store.categoryTypes.find((ct) => ct.id === id) ?? null;
      },
      async findCategoryTypeByName(name) {
        return store.categoryTypes.find((ct) => ct.name === name) ?? null;
      },
      async createCategoryType(name) {
        const record = { id: nextId('ct'), name };
        store.categoryTypes.push(record);
        return record;
      },
      async updateCategoryTypeName(id, name) {
        const record = store.categoryTypes.find((ct) => ct.id === id)!;
        record.name = name;
        return record;
      },
      async deleteCategoryType(id) {
        removeWhere(store.categoryTypes, (ct) => ct.id === id);
      },
      async findCategoryById(id) {
        return store.categories.find((c) => c.id === id) ?? null;
      },
      async findCategoryByNameInType(categoryTypeId, name) {
        return (
          store.categories.find(
            (c) => c.categoryTypeId === categoryTypeId && c.name === name,
          ) ?? null
        );
      },
      async findCategoryByNameAnywhere(name) {
        return store.categories.find((c) => c.name === name) ?? null;
      },
      async createCategory(categoryTypeId, name) {
        const record = { id: nextId('cat'), name, categoryTypeId };
        store.categories.push(record);
        return record;
      },
      async updateCategoryName(id, name) {
        const record = store.categories.find((c) => c.id === id)!;
        record.name = name;
        return record;
      },
      async deleteCategory(id) {
        removeWhere(store.categories, (c) => c.id === id);
      },
    },
    tags: {
      async findMaterialById(id) {
        return store.materials.find((m) => m.id === id) ?? null;
      },
      async countTagsForMaterial(studyMaterialId) {
        return store.tags.filter((t) => t.studyMaterialId === studyMaterialId)
          .length;
      },
      async findTag(studyMaterialId, categoryId) {
        return (
          store.tags.find(
            (t) =>
              t.studyMaterialId === studyMaterialId &&
              t.categoryId === categoryId,
          ) ?? null
        );
      },
      async createTag(studyMaterialId, categoryId) {
        const record = { id: nextId('tag'), studyMaterialId, categoryId };
        store.tags.push(record);
        return record;
      },
      async deleteTag(studyMaterialId, categoryId) {
        removeWhere(
          store.tags,
          (t) =>
            t.studyMaterialId === studyMaterialId &&
            t.categoryId === categoryId,
        );
      },
    },
  };

  const service = createCategoryService(deps);
  return { store, service };
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
  it('normalizeName trims surrounding whitespace and coalesces nullish', () => {
    expect(normalizeName('  Math  ')).toBe('Math');
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  it('isNameWithinBounds treats whitespace-only as empty', () => {
    expect(isNameWithinBounds('   ', 1, 100)).toBe(false);
    expect(isNameWithinBounds('a', 1, 100)).toBe(true);
    expect(isNameWithinBounds('a'.repeat(100), 1, 100)).toBe(true);
    expect(isNameWithinBounds('a'.repeat(101), 1, 100)).toBe(false);
  });

  it('wouldExceedTagLimit is true only at or above the limit', () => {
    expect(wouldExceedTagLimit(MAX_TAGS_PER_MATERIAL - 1)).toBe(false);
    expect(wouldExceedTagLimit(MAX_TAGS_PER_MATERIAL)).toBe(true);
    expect(wouldExceedTagLimit(MAX_TAGS_PER_MATERIAL + 1)).toBe(true);
  });

  it('property: names within [1,100] after trimming are accepted, others rejected', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 130 }), (raw) => {
        const trimmedLen = raw.trim().length;
        const expected = trimmedLen >= 1 && trimmedLen <= 100;
        expect(isNameWithinBounds(raw, 1, 100)).toBe(expected);
      }),
    );
  });
});

// --- Category Types -------------------------------------------------------

describe('Category Type management', () => {
  it('creates a Category Type with a valid unique name', async () => {
    const { service, store } = setup();
    const created = await service.createCategoryType('  Subject  ');
    expect(created.name).toBe('Subject');
    expect(store.categoryTypes).toHaveLength(1);
  });

  it('rejects an empty name and stores nothing', async () => {
    const { service, store } = setup();
    await expectStatus(service.createCategoryType('   '), 422);
    expect(store.categoryTypes).toHaveLength(0);
  });

  it('rejects a name exceeding 100 characters', async () => {
    const { service } = setup();
    await expectStatus(service.createCategoryType('a'.repeat(101)), 422);
  });

  it('rejects a duplicate Category Type name, leaving data unchanged', async () => {
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
    });
    await expectStatus(service.createCategoryType('Subject'), 422);
    expect(store.categoryTypes).toHaveLength(1);
  });

  it('renames a Category Type to a new unique name', async () => {
    const { service } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
    });
    const renamed = await service.renameCategoryType('ct_1', 'Topic');
    expect(renamed.name).toBe('Topic');
  });

  it('allows renaming a Category Type to its own current name', async () => {
    const { service } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
    });
    const renamed = await service.renameCategoryType('ct_1', 'Subject');
    expect(renamed.name).toBe('Subject');
  });

  it('rejects renaming to a name used by another Category Type', async () => {
    const { service } = setup({
      categoryTypes: [
        { id: 'ct_1', name: 'Subject' },
        { id: 'ct_2', name: 'Job' },
      ],
    });
    await expectStatus(service.renameCategoryType('ct_2', 'Subject'), 422);
  });

  it('returns not-found when renaming a missing Category Type', async () => {
    const { service } = setup();
    await expectStatus(service.renameCategoryType('missing', 'Subject'), 404);
  });

  it('deletes an existing Category Type', async () => {
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
    });
    await service.deleteCategoryType('ct_1');
    expect(store.categoryTypes).toHaveLength(0);
  });

  it('returns not-found when deleting a missing Category Type', async () => {
    const { service } = setup();
    await expectStatus(service.deleteCategoryType('missing'), 404);
  });
});

// --- Categories -----------------------------------------------------------

describe('Category management', () => {
  it('creates a Category under an existing Category Type', async () => {
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
    });
    const created = await service.createCategory('ct_1', 'Mathematics');
    expect(created).toMatchObject({ name: 'Mathematics', categoryTypeId: 'ct_1' });
    expect(store.categories).toHaveLength(1);
  });

  it('returns not-found when the parent Category Type is missing', async () => {
    const { service, store } = setup();
    await expectStatus(service.createCategory('missing', 'Mathematics'), 404);
    expect(store.categories).toHaveLength(0);
  });

  it('rejects a duplicate name within the same Category Type', async () => {
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories: [
        { id: 'cat_1', name: 'Mathematics', categoryTypeId: 'ct_1' },
      ],
    });
    await expectStatus(service.createCategory('ct_1', 'Mathematics'), 422);
    expect(store.categories).toHaveLength(1);
  });

  it('allows the same Category name under a different Category Type', async () => {
    const { service } = setup({
      categoryTypes: [
        { id: 'ct_1', name: 'Subject' },
        { id: 'ct_2', name: 'Job' },
      ],
      categories: [
        { id: 'cat_1', name: 'Analysis', categoryTypeId: 'ct_1' },
      ],
    });
    const created = await service.createCategory('ct_2', 'Analysis');
    expect(created.categoryTypeId).toBe('ct_2');
  });

  it('renames a Category to a unique name within its scope', async () => {
    const { service } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories: [{ id: 'cat_1', name: 'Math', categoryTypeId: 'ct_1' }],
    });
    const renamed = await service.renameCategory('cat_1', 'Mathematics');
    expect(renamed.name).toBe('Mathematics');
  });

  it('rejects renaming a Category to a name used by a sibling in the same type', async () => {
    const { service } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories: [
        { id: 'cat_1', name: 'Math', categoryTypeId: 'ct_1' },
        { id: 'cat_2', name: 'Science', categoryTypeId: 'ct_1' },
      ],
    });
    await expectStatus(service.renameCategory('cat_2', 'Math'), 422);
  });

  it('returns not-found when renaming or deleting a missing Category', async () => {
    const { service } = setup();
    await expectStatus(service.renameCategory('missing', 'Math'), 404);
    await expectStatus(service.deleteCategory('missing'), 404);
  });

  it('deletes an existing Category', async () => {
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories: [{ id: 'cat_1', name: 'Math', categoryTypeId: 'ct_1' }],
    });
    await service.deleteCategory('cat_1');
    expect(store.categories).toHaveLength(0);
  });
});

// --- Tag assignment -------------------------------------------------------

describe('Tag assignment', () => {
  function seededTagStore() {
    return setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories: [{ id: 'cat_1', name: 'Math', categoryTypeId: 'ct_1' }],
      materials: [{ id: 'mat_1' }],
    });
  }

  it('assigns a Tag and confirms the successful association', async () => {
    const { service, store } = seededTagStore();
    const result = await service.assignTag('mat_1', 'cat_1');
    expect(result.alreadyAssigned).toBe(false);
    expect(result.tag).toMatchObject({
      studyMaterialId: 'mat_1',
      categoryId: 'cat_1',
    });
    expect(store.tags).toHaveLength(1);
  });

  it('is idempotent when the Category is already assigned', async () => {
    const { service, store } = seededTagStore();
    await service.assignTag('mat_1', 'cat_1');
    const again = await service.assignTag('mat_1', 'cat_1');
    expect(again.alreadyAssigned).toBe(true);
    expect(store.tags).toHaveLength(1);
  });

  it('returns not-found when the Study Material does not exist', async () => {
    const { service } = seededTagStore();
    await expectStatus(service.assignTag('missing', 'cat_1'), 404);
  });

  it('rejects a Category not belonging to any supported Category Type', async () => {
    const { service, store } = seededTagStore();
    await expectStatus(service.assignTag('mat_1', 'cat_unknown'), 422);
    expect(store.tags).toHaveLength(0);
  });

  it('rejects assignment that would exceed the 50-Tag limit, leaving tags unchanged', async () => {
    // Seed a material already carrying the maximum number of tags.
    const categories: CategoryRecord[] = [];
    const tags: TagRecord[] = [];
    for (let i = 0; i < MAX_TAGS_PER_MATERIAL; i += 1) {
      categories.push({ id: `cat_${i}`, name: `C${i}`, categoryTypeId: 'ct_1' });
      tags.push({ id: `tag_${i}`, studyMaterialId: 'mat_1', categoryId: `cat_${i}` });
    }
    categories.push({ id: 'cat_extra', name: 'Extra', categoryTypeId: 'ct_1' });
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories,
      materials: [{ id: 'mat_1' }],
      tags,
    });
    expect(store.tags).toHaveLength(MAX_TAGS_PER_MATERIAL);
    await expectStatus(service.assignTag('mat_1', 'cat_extra'), 422);
    expect(store.tags).toHaveLength(MAX_TAGS_PER_MATERIAL);
  });

  it('allows assigning exactly up to the limit', async () => {
    const categories: CategoryRecord[] = [];
    const tags: TagRecord[] = [];
    for (let i = 0; i < MAX_TAGS_PER_MATERIAL - 1; i += 1) {
      categories.push({ id: `cat_${i}`, name: `C${i}`, categoryTypeId: 'ct_1' });
      tags.push({ id: `tag_${i}`, studyMaterialId: 'mat_1', categoryId: `cat_${i}` });
    }
    categories.push({ id: 'cat_last', name: 'Last', categoryTypeId: 'ct_1' });
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories,
      materials: [{ id: 'mat_1' }],
      tags,
    });
    await service.assignTag('mat_1', 'cat_last');
    expect(store.tags).toHaveLength(MAX_TAGS_PER_MATERIAL);
  });
});

describe('Tag removal', () => {
  it('removes an assigned Tag', async () => {
    const { service, store } = setup({
      categoryTypes: [{ id: 'ct_1', name: 'Subject' }],
      categories: [{ id: 'cat_1', name: 'Math', categoryTypeId: 'ct_1' }],
      materials: [{ id: 'mat_1' }],
      tags: [{ id: 'tag_1', studyMaterialId: 'mat_1', categoryId: 'cat_1' }],
    });
    await service.removeTag('mat_1', 'cat_1');
    expect(store.tags).toHaveLength(0);
  });

  it('returns not-found when the material is missing', async () => {
    const { service } = setup();
    await expectStatus(service.removeTag('missing', 'cat_1'), 404);
  });

  it('returns not-found when the Tag is not assigned', async () => {
    const { service } = setup({ materials: [{ id: 'mat_1' }] });
    await expectStatus(service.removeTag('mat_1', 'cat_1'), 404);
  });
});
