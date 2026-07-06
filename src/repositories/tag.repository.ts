// Tag repository (Req 2.1, 11.10–11.11).
//
// Wraps Prisma access to the `Tag` table. A Tag is a named classification value
// that belongs to a Category Type and whose name is unique within that Category
// Type (Req 11.11). Admins create, rename, and delete Tags; deleting a Tag
// cascades to its MaterialTag assignments via the schema relation.

import type { Tag } from '@prisma/client';

import { getPrismaClient } from './prismaClient';

/**
 * Create a Tag with `name` under `categoryTypeId` (Req 11.10). The
 * unique-within-type constraint is enforced by the database.
 */
export function createTag(
  categoryTypeId: string,
  name: string
): Promise<Tag> {
  return getPrismaClient().tag.create({
    data: { name, categoryTypeId },
  });
}

/**
 * Find a Tag by id, or `null` when none exists.
 */
export function findTagById(id: string): Promise<Tag | null> {
  return getPrismaClient().tag.findUnique({ where: { id } });
}

/**
 * Find a Tag by its name within a Category Type, or `null` when none exists.
 * Supports the scoped-uniqueness check before a create/rename (Req 11.11).
 */
export function findTagByName(
  categoryTypeId: string,
  name: string
): Promise<Tag | null> {
  return getPrismaClient().tag.findUnique({
    where: { categoryTypeId_name: { categoryTypeId, name } },
  });
}

/**
 * Find the first Tag with the given name across every Category Type, or `null`
 * when none exists. Supports resolving a Tag by name alone when a Study
 * Material's tags are supplied as plain names (the flat-tag UX): an existing
 * Tag is reused regardless of its Category Type before a new one is created.
 */
export function findFirstTagByName(name: string): Promise<Tag | null> {
  return getPrismaClient().tag.findFirst({ where: { name } });
}

/**
 * List the Tags defined within a Category Type, ordered by creation time for a
 * consistent order across views (Req 3.2).
 */
export function listTagsByType(categoryTypeId: string): Promise<Tag[]> {
  return getPrismaClient().tag.findMany({
    where: { categoryTypeId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Rename a Tag (Req 11.10). The unique-within-type constraint is enforced by
 * the database.
 */
export function renameTag(id: string, name: string): Promise<Tag> {
  return getPrismaClient().tag.update({
    where: { id },
    data: { name },
  });
}

/**
 * Delete a Tag by id (Req 11.10). Its MaterialTag assignments are removed via
 * the cascading relation defined in the schema.
 */
export function deleteTag(id: string): Promise<Tag> {
  return getPrismaClient().tag.delete({ where: { id } });
}
