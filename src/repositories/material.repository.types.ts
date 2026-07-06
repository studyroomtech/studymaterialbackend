// Types for the Study Material repository (Req 1.15: type declarations live
// only in `*.types.ts`).

import type {
  CategoryType,
  MaterialTag,
  StudyMaterial,
  Tag,
} from '@prisma/client';

/**
 * The metadata persisted for a new Study Material (Req 11.1, 1.13). File bytes
 * live in Object Storage; only the `objectKey` reference plus metadata are
 * stored in the database. Price fields are optional and remain unset in Phase 1
 * (price handling is added in Phase 2).
 */
export interface CreateMaterialInput {
  title: string;
  description?: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  priceAmount?: number | null;
  currency?: string;
}

/**
 * The editable Study Material metadata fields (Req 11.5, 11.6). Every field is
 * optional so callers can patch a subset; omitted fields are left unchanged.
 */
export interface UpdateMaterialInput {
  title?: string;
  description?: string;
  /**
   * The Study Material's Price amount, or `null` for a Free Material. Present
   * only when an Admin edits the Price; omitted to leave the stored Price
   * unchanged (Req 11.13, 11.14).
   */
  priceAmount?: number | null;
  /** The Price Currency (defaults to INR); present only on a Price edit (Req 11.13). */
  currency?: string;
}

/**
 * A MaterialTag with its Tag and the Tag's Category Type resolved, as needed
 * to group a material's Tags by Category Type in the catalog (Req 2.5).
 */
export type MaterialTagWithTag = MaterialTag & {
  tag: Tag & { categoryType: CategoryType };
};

/**
 * A Study Material together with its resolved Tag assignments, as returned by
 * the catalog and single-material reads (Req 2.5, 3.1, 5.1).
 */
export type MaterialWithTags = StudyMaterial & {
  materialTags: MaterialTagWithTag[];
};
