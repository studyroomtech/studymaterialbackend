// Tests for the pure catalog-building service (Req 2.5, 3.1, 3.10).
//
// Includes example/unit tests for the DTO-shaping rules and the design's
// numbered Property 3 (catalog shape includes every Category Type with the
// correct, possibly empty, Tags) verified across generated inputs.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildCatalog,
  buildMaterialDto,
  buildTagsByCategoryType,
} from './catalog.service';
import type { CategoryTypeDto } from '../types/domain.types';
import type { CatalogInput } from './catalog.service.types';

const subject: CategoryTypeDto = {
  id: 'ct_subject',
  name: 'Subject',
  categories: [
    { id: 'cat_math', name: 'Mathematics', categoryTypeId: 'ct_subject' },
    { id: 'cat_sci', name: 'Science', categoryTypeId: 'ct_subject' },
  ],
};

const job: CategoryTypeDto = {
  id: 'ct_job',
  name: 'Job',
  categories: [
    { id: 'cat_analyst', name: 'Data Analyst', categoryTypeId: 'ct_job' },
  ],
};

describe('buildTagsByCategoryType', () => {
  it('includes every supported Category Type key with an empty array when untagged', () => {
    const result = buildTagsByCategoryType([subject, job], []);
    expect(Object.keys(result).sort()).toEqual(['ct_job', 'ct_subject']);
    expect(result.ct_subject).toEqual([]);
    expect(result.ct_job).toEqual([]);
  });

  it('groups tags under their owning Category Type with resolved names', () => {
    const result = buildTagsByCategoryType(
      [subject, job],
      [{ categoryId: 'cat_math' }, { categoryId: 'cat_analyst' }],
    );
    expect(result.ct_subject).toEqual([
      { categoryId: 'cat_math', name: 'Mathematics' },
    ]);
    expect(result.ct_job).toEqual([
      { categoryId: 'cat_analyst', name: 'Data Analyst' },
    ]);
  });

  it('orders tags by the Category order defined within the type, not the tag input order', () => {
    const result = buildTagsByCategoryType(
      [subject],
      [{ categoryId: 'cat_sci' }, { categoryId: 'cat_math' }],
    );
    expect(result.ct_subject).toEqual([
      { categoryId: 'cat_math', name: 'Mathematics' },
      { categoryId: 'cat_sci', name: 'Science' },
    ]);
  });

  it('ignores tags whose Category is not in any supported Category Type', () => {
    const result = buildTagsByCategoryType(
      [subject, job],
      [{ categoryId: 'cat_unknown' }, { categoryId: 'cat_math' }],
    );
    expect(result.ct_subject).toEqual([
      { categoryId: 'cat_math', name: 'Mathematics' },
    ]);
    expect(result.ct_job).toEqual([]);
  });
});

describe('buildMaterialDto', () => {
  it('carries core metadata and computes the tag map', () => {
    const dto = buildMaterialDto([subject, job], {
      id: 'mat_1',
      title: 'Algebra Notes',
      description: 'Intro algebra',
      tags: [{ categoryId: 'cat_math' }],
    });
    expect(dto).toEqual({
      id: 'mat_1',
      title: 'Algebra Notes',
      description: 'Intro algebra',
      tagsByCategoryType: {
        ct_subject: [{ categoryId: 'cat_math', name: 'Mathematics' }],
        ct_job: [],
      },
    });
  });

  it('passes through optional file-metadata and price fields when present', () => {
    const dto = buildMaterialDto([subject], {
      id: 'mat_2',
      title: 'Notes',
      description: '',
      tags: [],
      fileName: 'notes.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: 1024,
      priceAmount: null,
      currency: 'INR',
      isPaid: false,
    });
    expect(dto.fileName).toBe('notes.pdf');
    expect(dto.contentType).toBe('application/pdf');
    expect(dto.fileSizeBytes).toBe(1024);
    expect(dto.priceAmount).toBeNull();
    expect(dto.currency).toBe('INR');
    expect(dto.isPaid).toBe(false);
  });

  it('omits optional fields that are not supplied', () => {
    const dto = buildMaterialDto([subject], {
      id: 'mat_3',
      title: 'Notes',
      description: '',
      tags: [],
    });
    expect(dto).not.toHaveProperty('fileName');
    expect(dto).not.toHaveProperty('priceAmount');
    expect(dto).not.toHaveProperty('currency');
  });
});

describe('buildCatalog', () => {
  it('echoes category types and shapes every material with all type keys', () => {
    const input: CatalogInput = {
      categoryTypes: [subject, job],
      materials: [
        {
          id: 'mat_1',
          title: 'Algebra Notes',
          description: 'Intro algebra',
          tags: [{ categoryId: 'cat_math' }],
        },
        {
          id: 'mat_2',
          title: 'Untagged',
          description: '',
          tags: [],
        },
      ],
    };
    const catalog = buildCatalog(input);
    expect(catalog.categoryTypes).toEqual([subject, job]);
    expect(catalog.materials).toHaveLength(2);
    for (const material of catalog.materials) {
      expect(Object.keys(material.tagsByCategoryType).sort()).toEqual([
        'ct_job',
        'ct_subject',
      ]);
    }
    expect(catalog.materials[1].tagsByCategoryType.ct_subject).toEqual([]);
    expect(catalog.materials[1].tagsByCategoryType.ct_job).toEqual([]);
  });

  it('returns an empty materials list when there are no materials', () => {
    const catalog = buildCatalog({ categoryTypes: [subject], materials: [] });
    expect(catalog.materials).toEqual([]);
    expect(catalog.categoryTypes).toEqual([subject]);
  });
});

// --- Generators for property-based testing -------------------------------

/**
 * Generate a set of supported Category Types with unique ids/category ids so
 * that each Category belongs to exactly one Category Type, mirroring the domain
 * invariant. Returns the Category Types plus a flat list of every Category id.
 */
const categoryTypesArb = fc
  .array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      categoryNames: fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
        maxLength: 4,
      }),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((rawTypes) => {
    // Ensure unique Category Type ids.
    const seenTypeIds = new Set<string>();
    const categoryTypes: CategoryTypeDto[] = [];
    const allCategoryIds: string[] = [];
    let categoryCounter = 0;

    rawTypes.forEach((raw, typeIndex) => {
      let typeId = raw.id;
      while (seenTypeIds.has(typeId)) {
        typeId = `${typeId}_${typeIndex}`;
      }
      seenTypeIds.add(typeId);

      const categories = raw.categoryNames.map((name) => {
        const categoryId = `cat_${categoryCounter}`;
        categoryCounter += 1;
        allCategoryIds.push(categoryId);
        return { id: categoryId, name, categoryTypeId: typeId };
      });

      categoryTypes.push({ id: typeId, name: raw.name, categories });
    });

    return { categoryTypes, allCategoryIds };
  });

describe('Property 3: catalog shape includes every category type with correct (possibly empty) tags', () => {
  // Validates: Requirements 2.5
  it('every material has an entry for every Category Type equal exactly to its tags under that type', () => {
    fc.assert(
      fc.property(
        categoryTypesArb.chain(({ categoryTypes, allCategoryIds }) => {
          // Pool of assignable category ids (may be empty) plus some unknown ids
          // that do not belong to any supported Category Type.
          const idPool =
            allCategoryIds.length > 0
              ? fc.constantFrom(...allCategoryIds, 'unknown_a', 'unknown_b')
              : fc.constantFrom('unknown_a', 'unknown_b');

          const materialsArb = fc.array(
            fc.record({
              id: fc.string({ minLength: 1, maxLength: 6 }),
              title: fc.string({ maxLength: 10 }),
              description: fc.string({ maxLength: 10 }),
              tags: fc.array(
                fc.record({ categoryId: idPool }),
                { maxLength: 8 },
              ),
            }),
            { maxLength: 6 },
          );

          return fc.record({
            categoryTypes: fc.constant(categoryTypes),
            materials: materialsArb,
          });
        }),
        (input: CatalogInput) => {
          const catalog = buildCatalog(input);
          const supportedIds = input.categoryTypes.map((ct) => ct.id);

          // Build a quick lookup: categoryId -> owning categoryTypeId.
          const ownerOf = new Map<string, string>();
          for (const ct of input.categoryTypes) {
            for (const category of ct.categories) {
              ownerOf.set(category.id, ct.id);
            }
          }

          catalog.materials.forEach((materialDto, index) => {
            const keys = Object.keys(materialDto.tagsByCategoryType).sort();
            // Every supported Category Type key is present, and no others.
            expect(keys).toEqual([...supportedIds].sort());

            // For each type, the tag list equals exactly the material's tags
            // assigned under that type (set of category ids), ignoring tags
            // whose category is not in any supported type.
            const rawTags = input.materials[index].tags;
            for (const ct of input.categoryTypes) {
              const expectedIds = new Set(
                rawTags
                  .map((t) => t.categoryId)
                  .filter((cid) => ownerOf.get(cid) === ct.id),
              );
              const actualIds = new Set(
                materialDto.tagsByCategoryType[ct.id].map((t) => t.categoryId),
              );
              expect(actualIds).toEqual(expectedIds);
            }
          });
        },
      ),
    );
  });
});
