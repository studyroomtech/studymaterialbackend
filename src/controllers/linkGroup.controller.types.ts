// Types for the admin Link Group controller (Req 1.15: type/interface
// declarations live only in `*.types.ts`).
//
// These describe the request body the link controller reads and the response
// DTOs it returns. The Zod schemas that validate the wire shape (materialIds
// present, an array, each a non-empty well-formed id, no repeated id) live in
// `linkGroup.controller.ts` as runtime values and are exported for the admin
// router to wire (task 12.2); the interfaces here mirror those validated shapes
// for the handlers to consume.

/**
 * The validated body of a link/merge request
 * (`POST /api/admin/materials/:id/link-group`): the other existing Study
 * Material ids to link the subject (`:id`) with. Shape validation (present, an
 * array, each a non-empty id, no repeated id) is enforced by the Zod schema
 * before the handler runs; count/distinctness/self-link/existence are validated
 * by the Link_Manager service (Req 2.1, 2.2, 11.5).
 */
export interface LinkGroupBody {
  materialIds: string[];
}

/**
 * `GET /api/admin/materials/:id/link-group` response — the sibling ids of the
 * material, excluding the material itself; empty when the material belongs to
 * no Link Group (Req 2.7, 2.8).
 */
export interface LinkGroupResponse {
  siblingIds: string[];
}

/**
 * The response returned by the link and unlink mutations
 * (`POST`/`DELETE .../link-group`): the subject's sibling ids after the
 * operation together with whether the operation changed any membership.
 * `changed` is `false` for an idempotent no-op — linking materials already in
 * the same group (Req 3.5) or unlinking an already-ungrouped material (Req 2.6).
 */
export interface LinkGroupMutationResponse {
  siblingIds: string[];
  changed: boolean;
}
