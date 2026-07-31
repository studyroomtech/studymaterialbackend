// Types for the Link Group repository (Req 1.15: type declarations live only in
// `*.types.ts`).
//
// These describe the plain membership rows the repository returns and the
// side-effect-free plan the pure grouping algebra hands back for the repository
// to apply atomically. Keeping them here lets both the repository and the pure
// Link_Manager service depend on a small, persistence-agnostic contract.

/**
 * A single Study Material's Link Group membership: the material id and the id
 * of the `MaterialLinkGroup` it belongs to, or `null` when the material is
 * ungrouped. Backs the conversion of persisted membership into the in-memory
 * `Grouping` the pure planner operates over (Req 3.2, 3.3).
 */
export interface MaterialMembership {
  materialId: string;
  linkGroupId: string | null;
}

/**
 * A Link Group member paired with its Price amount, used by the access gate to
 * decide whether a group is "paid-gated" — i.e. contains at least one Paid
 * Material. When any member is paid, every member of the group (including a
 * Free Material) is gated behind a Direct Entitlement to some member
 * (linked-material-entitlement: free notes inherit paid gating from their
 * group). `priceAmount` is `null`/`0` for a Free Material, positive for a Paid
 * Material.
 */
export interface LinkGroupMemberPrice {
  id: string;
  priceAmount: number | null;
}

/**
 * A computed, side-effect-free description of the membership writes to apply
 * for a link/merge/dissolve operation. The pure planner produces it and the
 * repository applies it inside a single transaction so the change is atomic
 * (Req 1.5, 3.2, 11.1).
 */
export interface LinkPlan {
  /**
   * Id of a brand-new `MaterialLinkGroup` to create (when a fresh group is
   * needed), or `null` to reuse an existing group referenced by
   * `assignToTarget`.
   */
  targetGroupId: string | null;
  /**
   * Materials to assign to the target group; each material's `linkGroupId`
   * becomes the target group's id.
   */
  assignToTarget: string[];
  /**
   * Materials whose `linkGroupId` becomes `null` (removed from their group via
   * unlink or dissolve).
   */
  clearMembership: string[];
  /** Ids of emptied `MaterialLinkGroup` rows to delete. */
  deleteGroups: string[];
}
