// User Record repository (Req 6.2, 6.4, 6.9).
//
// Wraps Prisma access to the `User` table, where each email is unique. The
// Download Gate upserts a User Record by email so that a repeat submission with
// an existing email reuses the same record rather than creating a duplicate
// (Req 6.4, 6.9). Lookups by id / email support resolving a Learner from an
// Access Token (Req 6.6).

import type { User } from '@prisma/client';

import { getPrismaClient } from './prismaClient';

/**
 * Upsert a User Record by its unique email (Req 6.4, 6.9).
 *
 * When a record already exists for `email`, the submission is associated with
 * that record and the stored `name` is refreshed to the latest submission;
 * otherwise a new record is created. Exactly one record ever exists per email.
 */
export function upsertUserByEmail(email: string, name: string): Promise<User> {
  return getPrismaClient().user.upsert({
    where: { email },
    update: { name },
    create: { email, name },
  });
}

/**
 * Find a User Record by its unique email, or `null` when none exists.
 */
export function findUserByEmail(email: string): Promise<User | null> {
  return getPrismaClient().user.findUnique({ where: { email } });
}

/**
 * Find a User Record by its id, or `null` when none exists. Used to resolve the
 * Learner referenced by an Access Token (Req 6.6).
 */
export function findUserById(id: string): Promise<User | null> {
  return getPrismaClient().user.findUnique({ where: { id } });
}

/**
 * Persist a new Password Hash on a User Record (Req 2.1), returning the updated
 * record. Overwrites any existing hash; the caller (Account Service) is
 * responsible for verifying the current Password before changing a
 * Password-Protected Account.
 */
export function setUserPasswordHash(id: string, passwordHash: string): Promise<User> {
  return getPrismaClient().user.update({
    where: { id },
    data: { passwordHash },
  });
}
