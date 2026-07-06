// Category Type repository (Req 2.1, 11.7–11.9).
//
// Wraps Prisma access to the `CategoryType` table. A Category Type has a unique
// name; admins create, rename, and delete Category Types, and the catalog reads
// every Category Type together with its Categories (Req 2.1, 3.2). Deleting a
// Category Type cascades to its Categories via the schema relation.

import type { CategoryType } from '@prisma/client';

import type { CategoryTypeWithCategories } from './categoryType.repository.types';
import { getPrismaClient } from './prismaClient';

/**
 * Create a Category Type with the given name (Req 11.7). The unique-name
 * constraint is enforced by the database; a duplicate name rejects.
 */
export function createCategoryType(name: string): Promise<CategoryType> {
  return getPrismaClient().categoryType.create({ data: { name } });
}

/**
 * Find a Category Type by id, or `null` when none exists.
 */
export function findCategoryTypeById(
  id: string
): Promise<CategoryType | null> {
  return getPrismaClient().categoryType.findUnique({ where: { id } });
}

/**
 * Find a Category Type by its unique name, or `null` when none exists. Supports
 * the scoped-uniqueness check before a create/rename (Req 11.7).
 */
export function findCategoryTypeByName(
  name: string
): Promise<CategoryType | null> {
  return getPrismaClient().categoryType.findUnique({ where: { name } });
}

/**
 * List all Category Types together with their Categories, ordered by creation
 * time so the catalog renders in a consistent order across views (Req 3.2).
 */
export function listCategoryTypesWithCategories(): Promise<
  CategoryTypeWithCategories[]
> {
  return getPrismaClient().categoryType.findMany({
    orderBy: { createdAt: 'asc' },
    include: { tags: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Rename a Category Type (Req 11.8). The unique-name constraint is enforced by
 * the database.
 */
export function renameCategoryType(
  id: string,
  name: string
): Promise<CategoryType> {
  return getPrismaClient().categoryType.update({
    where: { id },
    data: { name },
  });
}

/**
 * Delete a Category Type by id (Req 11.9). Its Categories are removed via the
 * cascading relation defined in the schema.
 */
export function deleteCategoryType(id: string): Promise<CategoryType> {
  return getPrismaClient().categoryType.delete({ where: { id } });
}
