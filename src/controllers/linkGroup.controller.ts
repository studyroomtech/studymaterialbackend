// Link Group controller — admin management of Study Material Link Groups
// (Req 2.1–2.8, 3.1–3.7, 11.5).
//
// Shapes the HTTP surface of the three admin link-group endpoints, delegating
// all grouping logic to the Link_Manager service (`linkGroup.service.ts`):
//
//   - `GET /api/admin/materials/:id/link-group` — read the material's current
//     sibling ids (empty when it belongs to no Link Group) (Req 2.7, 2.8).
//   - `POST /api/admin/materials/:id/link-group` — link/merge: place the
//     subject (`:id`) and every id in `materialIds` (plus their existing group
//     members) into a single Link Group (Req 2.1, 2.2, 3.1–3.7).
//   - `DELETE /api/admin/materials/:id/link-group` — unlink: remove the subject
//     from its Link Group, dissolving the group when fewer than two members
//     remain; a success no-op when the subject is already ungrouped (Req 2.4,
//     2.5, 2.6).
//
// Every handler runs behind the admin router chain `authMiddleware` →
// `requireAdmin` → `validate(Zod)` (wired in task 12.2), so the Req 11.6
// precedence — AUTH_REQUIRED → FORBIDDEN → VALIDATION_ERROR → NOT_FOUND — is
// enforced before any handler executes. The Zod schemas exported here validate
// the payload shape (materialIds present, an array, each a non-empty id, no
// repeated id) and produce VALIDATION_ERROR (422) on a malformed request
// (Req 11.5); count/distinctness/self-link/existence checks live in the service
// and surface VALIDATION_ERROR (422) / NOT_FOUND (404) via the error handler.
//
// The controller holds no business logic: handlers read the request, delegate,
// and shape the JSON response; typed domain errors thrown by the service are
// forwarded to the central error handler via `next(error)`.

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { createDefaultLinkGroupService } from '../services/linkGroup.service';
import type {
  LinkGroupBody,
  LinkGroupMutationResponse,
  LinkGroupResponse,
} from './linkGroup.controller.types';

// --- Zod validation schemas ------------------------------------------------
//
// Exported for the admin router to wire (task 12.2). The validate middleware
// evaluates these before any handler/service runs, so a malformed request is
// rejected with a ValidationError (422) naming each invalid field and never
// reaches persistence (Req 11.5).

/**
 * The `:id` route parameter of a link-group endpoint — the subject Study
 * Material the operation reads/links/unlinks. A required, non-empty id.
 */
export const linkGroupParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * The body of a link/merge request (`POST .../link-group`): `materialIds` must
 * be present, an array, each entry a non-empty well-formed id, and no id may be
 * repeated (Req 11.5). A payload that is absent, not an array, carries an
 * ill-formed id, or lists the same id more than once is rejected with a
 * VALIDATION_ERROR (422) before the service runs. Count/distinctness (≥2
 * counting the subject), the reference maximum, self-link, and existence are
 * enforced by the Link_Manager service (Req 2.1–2.3, 1.6, 3.6, 3.7).
 */
export const linkGroupBodySchema = z.object({
  materialIds: z
    .array(z.string().min(1))
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'materialIds must not list the same id more than once.',
    }),
});

// --- Handlers --------------------------------------------------------------

/**
 * `GET /api/admin/materials/:id/link-group` — return the material's current
 * sibling ids, excluding the material itself; an empty array when the material
 * belongs to no Link Group (Req 2.7, 2.8).
 */
export async function getLinkGroup(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const siblingIds = await createDefaultLinkGroupService().getSiblings(
      req.params.id,
    );
    const body: LinkGroupResponse = { siblingIds };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/admin/materials/:id/link-group` — link/merge the subject (`:id`)
 * with the referenced `materialIds` (and their existing group members) into a
 * single Link Group, returning the subject's sibling ids after the operation
 * (Req 2.1, 2.2, 3.1–3.7). Linking materials already in the same group succeeds
 * with `changed = false` (Req 3.5); a self-link, fewer than two distinct
 * materials, more than the reference maximum, or a non-existent reference is
 * rejected by the service (Req 1.6, 2.3, 3.6, 3.7, 11.2).
 */
export async function linkLinkGroup(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { materialIds } = req.body as LinkGroupBody;
    const result = await createDefaultLinkGroupService().linkMaterials({
      subjectId: req.params.id,
      referencedIds: materialIds,
    });
    const body: LinkGroupMutationResponse = {
      siblingIds: result.siblingIds,
      changed: result.changed,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `DELETE /api/admin/materials/:id/link-group` — remove the subject (`:id`)
 * from its Link Group, dissolving the group when fewer than two members remain
 * (Req 2.4, 2.5). When the subject is already ungrouped the operation is a
 * success no-op reporting `changed = false` and no siblings (Req 2.6). Returns
 * the subject's sibling ids after the operation (empty once unlinked).
 */
export async function unlinkLinkGroup(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await createDefaultLinkGroupService().unlinkMaterial(
      req.params.id,
    );
    const body: LinkGroupMutationResponse = {
      siblingIds: result.siblingIds,
      changed: result.changed,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
