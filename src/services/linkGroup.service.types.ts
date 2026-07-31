// Types for the Link_Manager service (Req 1.15: type/interface declarations
// live only in `*.types.ts`).
//
// These describe:
//   - the in-memory `Grouping` the pure grouping algebra operates over,
//   - the inputs/results of the public service surface, and
//   - the narrow repository contract the service is constructed over, so the
//     pure planner and the orchestration factory can be unit- and
//     property-tested with injected fakes independent of Prisma.
//
// The persistence-shaped `MaterialMembership` and `LinkPlan` are reused from
// the Link Group repository types so the service and repository share a single
// contract.

import type {
  MaterialMembership,
  LinkPlan,
} from '../repositories/linkGroup.repository.types';

/**
 * The in-memory representation of Link Group membership the pure algebra
 * operates over: a set of disjoint groups, each an array of ≥2 distinct member
 * ids, with no id appearing in more than one group. Materials absent from every
 * group are ungrouped. This structure makes the at-most-one-group invariant
 * (Req 3.3) and the ≥2-members invariant (Req 3.4) explicit and property
 * testable in isolation from persistence.
 */
export type Grouping = readonly (readonly string[])[];

/**
 * The input to a link/merge operation: the subject material being created or
 * edited (always part of the resulting union) together with the other referenced
 * material ids to link/merge it with (Req 1.1, 1.2, 2.1, 2.2).
 */
export interface LinkMaterialsInput {
  /** The material being linked (the created/edited subject); always in the union. */
  subjectId: string;
  /** The other referenced material ids to link/merge with the subject. */
  referencedIds: readonly string[];
}

/**
 * The result of a link or unlink operation: the subject's sibling ids after the
 * operation (Req 2.7) and whether any membership actually changed. `changed` is
 * `false` for an idempotent no-op — linking materials already in the same group
 * (Req 3.5) or unlinking an already-ungrouped material (Req 2.6).
 */
export interface LinkGroupResult {
  /** The subject's sibling ids after the operation (Req 2.7). */
  siblingIds: string[];
  /** Whether the operation changed any membership (`false` ⇒ idempotent no-op). */
  changed: boolean;
}

/**
 * Persistence contract for Link Group membership consumed by the Link_Manager
 * service. The concrete implementation wraps Prisma and never throws for
 * "not found" — it returns plain data so the service can compute the
 * `NOT_FOUND` set and leave every group unchanged on failure (Req 1.5, 3.7,
 * 11.1). `applyLinkPlan` applies all membership writes inside a single
 * transaction so a link/merge/dissolve is atomic.
 */
export interface LinkGroupRepository {
  /** The membership of each referenced material (or `null` when ungrouped). */
  findMembershipFor(materialIds: string[]): Promise<MaterialMembership[]>;
  /** Member ids of the group the material belongs to (self + siblings); `[]` when ungrouped. */
  listGroupMemberIds(materialId: string): Promise<string[]>;
  /** Sibling ids of the material (group members excluding itself); `[]` when ungrouped (Req 2.7, 2.8). */
  listSiblingIds(materialId: string): Promise<string[]>;
  /** All `(materialId → linkGroupId)` memberships for a set of materials, for the listing (Req 6.1). */
  listMembershipsForMaterials(
    materialIds: string[],
  ): Promise<MaterialMembership[]>;
  /** Which of the given materials exist; used to compute the `NOT_FOUND` set (Req 1.5, 3.7, 11.1). */
  findExistingMaterialIds(materialIds: string[]): Promise<string[]>;
  /** Apply a computed grouping plan atomically (create/reuse group, reassign members, delete emptied groups). */
  applyLinkPlan(plan: LinkPlan): Promise<void>;
}

/**
 * The dependency bundle the Link_Manager service is constructed with. The
 * concrete Prisma-backed Link Group repository is injected by
 * `createDefaultLinkGroupService`, keeping the service logic independent of
 * Prisma for testing.
 */
export interface LinkGroupServiceDeps {
  linkGroups: LinkGroupRepository;
}

/**
 * The public surface of the Link_Manager service. Every method resolves with
 * its result or throws a typed domain error (ValidationError → 422,
 * NotFoundError → 404) that the errorHandler maps to the unified Error Envelope.
 */
export interface LinkGroupService {
  /**
   * Link a material to a set of others (create/merge). Validates distinct count,
   * the reference maximum, self-link, and existence before any write; linking
   * materials already in the same group succeeds with no change (Req 1.1–1.6,
   * 2.1–2.3, 3.5, 3.6, 11.2).
   */
  linkMaterials(input: LinkMaterialsInput): Promise<LinkGroupResult>;
  /**
   * Remove a material from its Link Group, dissolving the group when fewer than
   * two members remain. A no-op that reports success when the material is
   * already ungrouped (Req 2.4, 2.5, 2.6).
   */
  unlinkMaterial(materialId: string): Promise<LinkGroupResult>;
  /** Read the current sibling ids of a material (Req 2.7, 2.8). */
  getSiblings(materialId: string): Promise<string[]>;
}
