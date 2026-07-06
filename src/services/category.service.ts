// Category management service — Category Types, Categories, and Tag assignment.
//
// This service implements the admin Content Management Actions for the category
// structure plus Study Material Tag assignment:
//
//   - Create / rename / delete Category Types (name 1–100 chars, unique across
//     all Category Types) (Req 2.1, 11.7, 11.9, 11.10, 11.11, 11.12).
//   - Create / rename / delete Categories (name 1–100 chars, unique within the
//     owning Category Type) (Req 11.8, 11.9, 11.10, 11.11, 11.12).
//   - Assign / remove a Tag, enforcing the 50-Tag-per-material limit and that a
//     Tag's Category belongs to a supported Category Type (Req 2.2, 2.3, 2.4).
//
// Business rules that don't require I/O — name normalization and length/empty
// validation, and the Tag-limit check — are isolated into exported pure
// functions so they can be reasoned about and property-tested without a
// repository. Persistence is reached only through the injected repository
// contracts (`CategoryRepository`, `TagRepository`), keeping the service
// independent of Prisma.
//
// Failures are signaled with typed domain errors (ValidationError → 422,
// NotFoundError → 404) that the errorHandler maps to the unified error envelope
// without leaking internals (Req 8.3, 8.4).

import {
  CATEGORY_TYPE_NAME_MAX_LENGTH,
  CATEGORY_TYPE_NAME_MIN_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_NAME_MIN_LENGTH,
  MAX_TAGS_PER_MATERIAL,
} from '../constants/limits.constant';
import { DEFAULT_CATEGORY_TYPE_NAME } from '../constants/categoryTypes.constant';
import { NotFoundError, ValidationError } from '../utils/errors';
import * as categoryTypeRepository from '../repositories/categoryType.repository';
import * as materialRepository from '../repositories/material.repository';
import * as materialTagRepository from '../repositories/materialTag.repository';
import * as tagRepository from '../repositories/tag.repository';
import type { ApiErrorFieldDto } from '../types/api.types';
import type {
  CategoryRecord,
  CategoryService,
  CategoryServiceDeps,
  CategoryTypeRecord,
  TagAssignmentResult,
} from './category.service.types';

// --- Pure validation helpers (no I/O) -------------------------------------

/**
 * Normalize a raw name by trimming leading and trailing whitespace. Trimming is
 * applied before length/empty validation and before persistence so that a
 * whitespace-only name is treated as empty and stored names are canonical.
 */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim();
}

/**
 * Whether a normalized name satisfies the inclusive `[min, max]` character
 * bound. A blank (whitespace-only) name normalizes to an empty string and is
 * rejected whenever `min >= 1` (Req 11.11).
 */
export function isNameWithinBounds(
  name: string | null | undefined,
  min: number,
  max: number,
): boolean {
  const length = normalizeName(name).length;
  return length >= min && length <= max;
}

/**
 * Validate a name against the given bounds, returning the normalized value on
 * success or throwing a `ValidationError` that names the invalid field and the
 * reason (empty vs too long) (Req 11.11, 8.3). Pure aside from the throw.
 */
function validateNameOrThrow(
  rawName: string | null | undefined,
  field: string,
  min: number,
  max: number,
): string {
  const name = normalizeName(rawName);
  if (name.length < min) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [{ field, reason: `${field} must not be empty.` }],
    );
  }
  if (name.length > max) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [{ field, reason: `${field} must be at most ${max} characters.` }],
    );
  }
  return name;
}

/**
 * Whether assigning one additional (new) Tag to a material that currently holds
 * `currentTagCount` Tags would exceed the per-material limit (Req 2.2, 2.4).
 * Pure.
 */
export function wouldExceedTagLimit(currentTagCount: number): boolean {
  return currentTagCount >= MAX_TAGS_PER_MATERIAL;
}

/** Build the single-field validation payload for a duplicate-name rejection. */
function duplicateNameFields(field: string): ApiErrorFieldDto[] {
  return [{ field, reason: `${field} must be unique within its scope.` }];
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the Category management service over the injected repositories.
 * The controller layer wires in the concrete Prisma-backed implementations.
 */
export function createCategoryService(
  deps: CategoryServiceDeps,
): CategoryService {
  const { categories, tags } = deps;

  /**
   * Create a Category Type with a unique name of 1–100 characters (Req 11.7).
   * Rejects an empty/oversized name or a name that duplicates an existing
   * Category Type, leaving stored data unchanged (Req 11.11).
   */
  async function createCategoryType(
    rawName: string,
  ): Promise<CategoryTypeRecord> {
    const name = validateNameOrThrow(
      rawName,
      'name',
      CATEGORY_TYPE_NAME_MIN_LENGTH,
      CATEGORY_TYPE_NAME_MAX_LENGTH,
    );
    const existing = await categories.findCategoryTypeByName(name);
    if (existing !== null) {
      throw new ValidationError(
        'A Category Type with this name already exists.',
        duplicateNameFields('name'),
      );
    }
    return categories.createCategoryType(name);
  }

  /**
   * Rename an existing Category Type to a unique name of 1–100 characters
   * (Req 11.9). Missing target → not-found (Req 11.12); duplicate name (other
   * than the target itself) → validation error with data unchanged (Req 11.11).
   */
  async function renameCategoryType(
    id: string,
    rawName: string,
  ): Promise<CategoryTypeRecord> {
    const name = validateNameOrThrow(
      rawName,
      'name',
      CATEGORY_TYPE_NAME_MIN_LENGTH,
      CATEGORY_TYPE_NAME_MAX_LENGTH,
    );
    const current = await categories.findCategoryTypeById(id);
    if (current === null) {
      throw new NotFoundError('The requested Category Type was not found.');
    }
    const clash = await categories.findCategoryTypeByName(name);
    if (clash !== null && clash.id !== id) {
      throw new ValidationError(
        'A Category Type with this name already exists.',
        duplicateNameFields('name'),
      );
    }
    return categories.updateCategoryTypeName(id, name);
  }

  /**
   * Delete an existing Category Type (Req 11.10). Missing target → not-found
   * with data unchanged (Req 11.12).
   */
  async function deleteCategoryType(id: string): Promise<void> {
    const current = await categories.findCategoryTypeById(id);
    if (current === null) {
      throw new NotFoundError('The requested Category Type was not found.');
    }
    await categories.deleteCategoryType(id);
  }

  /**
   * Create a Category with a name of 1–100 characters under an existing
   * Category Type (Req 11.8). Missing Category Type → not-found (Req 11.12);
   * duplicate name within that Category Type → validation error with data
   * unchanged (Req 11.11).
   */
  async function createCategory(
    categoryTypeId: string,
    rawName: string,
  ): Promise<CategoryRecord> {
    const name = validateNameOrThrow(
      rawName,
      'name',
      CATEGORY_NAME_MIN_LENGTH,
      CATEGORY_NAME_MAX_LENGTH,
    );
    const parent = await categories.findCategoryTypeById(categoryTypeId);
    if (parent === null) {
      throw new NotFoundError('The requested Category Type was not found.');
    }
    const existing = await categories.findCategoryByNameInType(
      categoryTypeId,
      name,
    );
    if (existing !== null) {
      throw new ValidationError(
        'A Category with this name already exists in this Category Type.',
        duplicateNameFields('name'),
      );
    }
    return categories.createCategory(categoryTypeId, name);
  }

  /**
   * Rename an existing Category to a name of 1–100 characters that is unique
   * within its owning Category Type (Req 11.9). Missing target → not-found
   * (Req 11.12); duplicate name within scope → validation error with data
   * unchanged (Req 11.11).
   */
  async function renameCategory(
    id: string,
    rawName: string,
  ): Promise<CategoryRecord> {
    const name = validateNameOrThrow(
      rawName,
      'name',
      CATEGORY_NAME_MIN_LENGTH,
      CATEGORY_NAME_MAX_LENGTH,
    );
    const current = await categories.findCategoryById(id);
    if (current === null) {
      throw new NotFoundError('The requested Category was not found.');
    }
    const clash = await categories.findCategoryByNameInType(
      current.categoryTypeId,
      name,
    );
    if (clash !== null && clash.id !== id) {
      throw new ValidationError(
        'A Category with this name already exists in this Category Type.',
        duplicateNameFields('name'),
      );
    }
    return categories.updateCategoryName(id, name);
  }

  /**
   * Delete an existing Category (Req 11.10). Missing target → not-found with
   * data unchanged (Req 11.12).
   */
  async function deleteCategory(id: string): Promise<void> {
    const current = await categories.findCategoryById(id);
    if (current === null) {
      throw new NotFoundError('The requested Category was not found.');
    }
    await categories.deleteCategory(id);
  }

  /**
   * Assign a Tag (a Category) to a Study Material, confirming success
   * (Req 2.3). Enforces that the Category belongs to a supported Category Type
   * and that the assignment would not exceed the 50-Tag limit; otherwise the
   * assignment is rejected and the material's existing Tags are left unchanged
   * (Req 2.2, 2.4). Assigning an already-assigned Category is idempotent: no
   * duplicate Tag is created and the Tag count is unchanged.
   */
  async function assignTag(
    studyMaterialId: string,
    categoryId: string,
  ): Promise<TagAssignmentResult> {
    const material = await tags.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }

    // A Tag is only valid when its Category exists and therefore belongs to a
    // supported Category Type (Req 2.4).
    const category = await categories.findCategoryById(categoryId);
    if (category === null) {
      throw new ValidationError(
        'The Tag does not belong to any supported Category Type.',
        [
          {
            field: 'categoryId',
            reason: 'categoryId must reference an existing Category.',
          },
        ],
      );
    }

    // Idempotent: an already-assigned Category leaves Tags unchanged and does
    // not count against the limit again (Req 2.3).
    const existing = await tags.findTag(studyMaterialId, categoryId);
    if (existing !== null) {
      return { tag: existing, alreadyAssigned: true };
    }

    const currentTagCount = await tags.countTagsForMaterial(studyMaterialId);
    if (wouldExceedTagLimit(currentTagCount)) {
      throw new ValidationError(
        `A Study Material may have at most ${MAX_TAGS_PER_MATERIAL} Tags.`,
        [
          {
            field: 'categoryId',
            reason: `assigning this Tag would exceed the ${MAX_TAGS_PER_MATERIAL}-Tag limit.`,
          },
        ],
      );
    }

    const tag = await tags.createTag(studyMaterialId, categoryId);
    return { tag, alreadyAssigned: false };
  }

  /**
   * Remove a Tag (a Category) from a Study Material. Missing material or a
   * Category that is not currently assigned → not-found, with data unchanged.
   */
  async function removeTag(
    studyMaterialId: string,
    categoryId: string,
  ): Promise<void> {
    const material = await tags.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }
    const existing = await tags.findTag(studyMaterialId, categoryId);
    if (existing === null) {
      throw new NotFoundError(
        'The requested Tag is not assigned to this Study Material.',
      );
    }
    await tags.deleteTag(studyMaterialId, categoryId);
  }

  /**
   * Resolve the default ("General") Category Type, creating it on first use.
   * New Categories typed ad hoc when creating a Study Material are placed here
   * so the UX can present Categories as one flat list.
   */
  async function resolveDefaultCategoryType(): Promise<CategoryTypeRecord> {
    const existing = await categories.findCategoryTypeByName(
      DEFAULT_CATEGORY_TYPE_NAME,
    );
    if (existing !== null) {
      return existing;
    }
    return categories.createCategoryType(DEFAULT_CATEGORY_TYPE_NAME);
  }

  /**
   * Resolve a Category by name, reusing an existing one (regardless of its
   * Category Type) or creating a new one under the default Category Type
   * (Req 2.1). The name is assumed already validated by the caller.
   */
  async function resolveCategoryByName(name: string): Promise<CategoryRecord> {
    const existing = await categories.findCategoryByNameAnywhere(name);
    if (existing !== null) {
      return existing;
    }
    const defaultType = await resolveDefaultCategoryType();
    return categories.createCategory(defaultType.id, name);
  }

  /**
   * Assign a flat list of Categories (by name) to a Study Material. Each name
   * is normalized/validated, resolved to an existing Category or auto-created
   * under the default Category Type, then tagged onto the material idempotently
   * while respecting the per-material Tag limit (Req 2.2, 2.3, 2.4). Blank and
   * duplicate names are ignored.
   */
  async function applyCategoriesByName(
    studyMaterialId: string,
    names: string[],
  ): Promise<void> {
    const material = await tags.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }

    // Normalize, drop blanks, and de-duplicate (case-preserving) so a repeated
    // name is only applied once.
    const uniqueNames = Array.from(
      new Set(
        names
          .map((name) => normalizeName(name))
          .filter((name) => name.length > 0),
      ),
    );

    for (const rawName of uniqueNames) {
      const name = validateNameOrThrow(
        rawName,
        'categories',
        CATEGORY_NAME_MIN_LENGTH,
        CATEGORY_NAME_MAX_LENGTH,
      );
      const category = await resolveCategoryByName(name);

      // Idempotent: skip a Category already tagged on this material.
      const existing = await tags.findTag(studyMaterialId, category.id);
      if (existing !== null) {
        continue;
      }
      const currentTagCount = await tags.countTagsForMaterial(studyMaterialId);
      if (wouldExceedTagLimit(currentTagCount)) {
        throw new ValidationError(
          `A Study Material may have at most ${MAX_TAGS_PER_MATERIAL} Tags.`,
          [
            {
              field: 'categories',
              reason: `assigning this category would exceed the ${MAX_TAGS_PER_MATERIAL}-category limit.`,
            },
          ],
        );
      }
      await tags.createTag(studyMaterialId, category.id);
    }
  }

  /**
   * Assign a flat list of Categories (by name) to a Study Material, scoped to a
   * named Category Type (resolved or created on first use, e.g. "Subject" or
   * "Job"). Each name is normalized/validated, resolved to an existing Category
   * *within that Category Type* or created there, then tagged onto the material
   * idempotently while respecting the per-material Tag limit (Req 2.2, 2.3,
   * 2.4). Blank and duplicate names are ignored.
   */
  async function applyCategoriesForType(
    studyMaterialId: string,
    categoryTypeName: string,
    names: string[],
  ): Promise<void> {
    const material = await tags.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }

    const uniqueNames = Array.from(
      new Set(
        names
          .map((name) => normalizeName(name))
          .filter((name) => name.length > 0),
      ),
    );
    if (uniqueNames.length === 0) {
      return;
    }

    // Resolve (or create) the target Category Type by name so Subjects/Jobs
    // land under their own dimension.
    let categoryType = await categories.findCategoryTypeByName(categoryTypeName);
    if (categoryType === null) {
      categoryType = await categories.createCategoryType(categoryTypeName);
    }

    for (const rawName of uniqueNames) {
      const name = validateNameOrThrow(
        rawName,
        'categories',
        CATEGORY_NAME_MIN_LENGTH,
        CATEGORY_NAME_MAX_LENGTH,
      );
      let category = await categories.findCategoryByNameInType(
        categoryType.id,
        name,
      );
      if (category === null) {
        category = await categories.createCategory(categoryType.id, name);
      }

      // Idempotent: skip a Category already tagged on this material.
      const existing = await tags.findTag(studyMaterialId, category.id);
      if (existing !== null) {
        continue;
      }
      const currentTagCount = await tags.countTagsForMaterial(studyMaterialId);
      if (wouldExceedTagLimit(currentTagCount)) {
        throw new ValidationError(
          `A Study Material may have at most ${MAX_TAGS_PER_MATERIAL} Tags.`,
          [
            {
              field: 'categories',
              reason: `assigning this category would exceed the ${MAX_TAGS_PER_MATERIAL}-category limit.`,
            },
          ],
        );
      }
      await tags.createTag(studyMaterialId, category.id);
    }
  }

  return {
    createCategoryType,
    renameCategoryType,
    deleteCategoryType,
    createCategory,
    renameCategory,
    deleteCategory,
    assignTag,
    removeTag,
    applyCategoriesByName,
    applyCategoriesForType,
  };
}

// --- Default wiring -------------------------------------------------------

/**
 * Construct the Category management service wired to the real Prisma-backed
 * Category Type, Category, Tag, and Study Material repositories. Used by the
 * controller layer in production (mirrors `createDefaultDownloadService`). The
 * thin adapters bridge the repository function names and discard the deleted
 * records the repositories return so they satisfy the service's `void`-returning
 * delete contracts.
 */
export function createDefaultCategoryService(): CategoryService {
  return createCategoryService({
    categories: {
      findCategoryTypeById: categoryTypeRepository.findCategoryTypeById,
      findCategoryTypeByName: categoryTypeRepository.findCategoryTypeByName,
      createCategoryType: categoryTypeRepository.createCategoryType,
      async updateCategoryTypeName(id, name) {
        return categoryTypeRepository.renameCategoryType(id, name);
      },
      async deleteCategoryType(id) {
        await categoryTypeRepository.deleteCategoryType(id);
      },
      findCategoryById: tagRepository.findTagById,
      findCategoryByNameInType: tagRepository.findTagByName,
      findCategoryByNameAnywhere: tagRepository.findFirstTagByName,
      createCategory: tagRepository.createTag,
      async updateCategoryName(id, name) {
        return tagRepository.renameTag(id, name);
      },
      async deleteCategory(id) {
        await tagRepository.deleteTag(id);
      },
    },
    tags: {
      async findMaterialById(id) {
        const material = await materialRepository.findMaterialById(id);
        return material === null ? null : { id: material.id };
      },
      countTagsForMaterial: materialTagRepository.countMaterialTagsForMaterial,
      // Map the persisted MaterialTag (`tagId`) to the domain assignment record
      // (`categoryId`), which the service/DTO layer keeps as-is.
      async findTag(studyMaterialId, categoryId) {
        const record = await materialTagRepository.findMaterialTag(
          studyMaterialId,
          categoryId,
        );
        return record === null
          ? null
          : {
              id: record.id,
              studyMaterialId: record.studyMaterialId,
              categoryId: record.tagId,
            };
      },
      async createTag(studyMaterialId, categoryId) {
        const record = await materialTagRepository.createMaterialTag(
          studyMaterialId,
          categoryId,
        );
        return {
          id: record.id,
          studyMaterialId: record.studyMaterialId,
          categoryId: record.tagId,
        };
      },
      async deleteTag(studyMaterialId, categoryId) {
        await materialTagRepository.deleteMaterialTag(studyMaterialId, categoryId);
      },
    },
  });
}
