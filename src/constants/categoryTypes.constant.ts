// Initial Category Types seeded into the Platform.
//
// The Platform supports at least two Category Types — a Subject Category Type
// and a Job Category Type — where each Category Type has a unique name of 1 to
// 100 characters (Req 2.1). These are the names created by the database seed so
// that a freshly provisioned Platform starts with the two required dimensions of
// classification available for tagging Study Materials.
//
// The names are also the single source of truth for the seed's idempotent
// upsert-by-unique-name behavior, and can be reused by category services and
// tests that reference the initial Category Types.

export const SUBJECT_CATEGORY_TYPE_NAME = 'Subject';
export const JOB_CATEGORY_TYPE_NAME = 'Job';

/**
 * Internal default Category Type under which Categories created ad hoc from a
 * Study Material's category selection are placed. The UX presents Categories as
 * a single flat list, so newly typed category names are auto-created under this
 * one dimension rather than requiring an Admin to pick a Category Type.
 */
export const DEFAULT_CATEGORY_TYPE_NAME = 'General';

// The full, ordered set of Category Type names created during seeding (Req 2.1).
export const INITIAL_CATEGORY_TYPE_NAMES = [
  SUBJECT_CATEGORY_TYPE_NAME,
  JOB_CATEGORY_TYPE_NAME,
] as const;
