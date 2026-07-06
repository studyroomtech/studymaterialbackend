// Types for the Category management service (Req 1.15: type/interface
// declarations live only in `*.types.ts`).
//
// This module describes:
//   - the persistence records the service reads/writes (Category Types,
//     Categories, Tags),
//   - the repository interfaces the service depends on (the concrete
//     Prisma-backed implementations live in `src/repositories/` and are wired
//     in by the controller layer), and
//   - the public surface of the Category service itself.
//
// Keeping the repository contract here lets `category.service.ts` be written
// and property-tested against a small, well-defined dependency boundary,
// independent of Prisma (Req 2.1–2.4, 11.7–11.11).

/**
 * A persisted Category Type — a classification dimension such as Subject or
 * Job, identified by id and carrying a name unique across all Category Types
 * (Req 2.1, 11.7).
 */
export interface CategoryTypeRecord {
  id: string;
  name: string;
}

/**
 * A persisted Category — a named classification value within a Category Type.
 * Its name is unique within its owning Category Type (Req 11.11).
 */
export interface CategoryRecord {
  id: string;
  name: string;
  categoryTypeId: string;
}

/**
 * A persisted Tag — the assignment of a Category to a Study Material
 * (Req 2.3).
 */
export interface TagRecord {
  id: string;
  studyMaterialId: string;
  categoryId: string;
}

/**
 * Persistence contract for Category Types and Categories consumed by the
 * Category service. The concrete implementation wraps Prisma; every lookup
 * returns `null` (never throws) when the target does not exist so the service
 * can map absence to the appropriate domain error (Req 11.11, 11.12).
 */
export interface CategoryRepository {
  /** Load a Category Type by id, or `null` when it does not exist. */
  findCategoryTypeById(id: string): Promise<CategoryTypeRecord | null>;

  /**
   * Load a Category Type by its exact name, or `null` when none matches. Used
   * to enforce global name uniqueness for Category Types (Req 11.7, 11.11).
   */
  findCategoryTypeByName(name: string): Promise<CategoryTypeRecord | null>;

  /** Persist a new Category Type with the given (validated) name. */
  createCategoryType(name: string): Promise<CategoryTypeRecord>;

  /** Update an existing Category Type's name. */
  updateCategoryTypeName(id: string, name: string): Promise<CategoryTypeRecord>;

  /** Delete a Category Type (its Categories/Tags cascade in the schema). */
  deleteCategoryType(id: string): Promise<void>;

  /** Load a Category by id, or `null` when it does not exist. */
  findCategoryById(id: string): Promise<CategoryRecord | null>;

  /**
   * Load a Category by its exact name within a specific Category Type, or
   * `null` when none matches. Used to enforce name uniqueness scoped to the
   * owning Category Type (Req 11.11).
   */
  findCategoryByNameInType(
    categoryTypeId: string,
    name: string,
  ): Promise<CategoryRecord | null>;

  /**
   * Load the first Category with the given name across every Category Type, or
   * `null` when none matches. Used by the flat-category flow to reuse an
   * existing Category by name regardless of its owning Category Type before
   * creating a new one.
   */
  findCategoryByNameAnywhere(name: string): Promise<CategoryRecord | null>;

  /** Persist a new Category under the given Category Type. */
  createCategory(
    categoryTypeId: string,
    name: string,
  ): Promise<CategoryRecord>;

  /** Update an existing Category's name. */
  updateCategoryName(id: string, name: string): Promise<CategoryRecord>;

  /** Delete a Category (its Tags cascade in the schema). */
  deleteCategory(id: string): Promise<void>;
}

/**
 * Persistence contract for Study Material Tag assignment consumed by the
 * Category service. Tag membership validity is checked against
 * {@link CategoryRepository.findCategoryById}; this contract covers the
 * material-scoped Tag operations (Req 2.2–2.4).
 */
export interface TagRepository {
  /** Confirm a Study Material exists, returning its id or `null`. */
  findMaterialById(id: string): Promise<{ id: string } | null>;

  /** Count the Tags currently assigned to a Study Material (Req 2.2). */
  countTagsForMaterial(studyMaterialId: string): Promise<number>;

  /**
   * Load the Tag assigning a specific Category to a Study Material, or `null`
   * when the Category is not currently assigned. Enables idempotent assignment
   * and precise removal.
   */
  findTag(
    studyMaterialId: string,
    categoryId: string,
  ): Promise<TagRecord | null>;

  /** Persist a new Tag assigning the Category to the Study Material. */
  createTag(studyMaterialId: string, categoryId: string): Promise<TagRecord>;

  /** Remove the Tag assigning the Category from the Study Material. */
  deleteTag(studyMaterialId: string, categoryId: string): Promise<void>;
}

/**
 * The dependency bundle the Category service is constructed with. The concrete
 * Prisma-backed repositories are injected by the controller layer.
 */
export interface CategoryServiceDeps {
  categories: CategoryRepository;
  tags: TagRepository;
}

/**
 * The result of a Tag assignment, confirming the successful association of a
 * Category with a Study Material (Req 2.3). `alreadyAssigned` is `true` when
 * the Category was already tagged, in which case no duplicate Tag is created
 * and the material's Tags are left unchanged.
 */
export interface TagAssignmentResult {
  tag: TagRecord;
  alreadyAssigned: boolean;
}

/**
 * The public surface of the Category management service. All methods are
 * asynchronous and either resolve with the affected record or throw a typed
 * domain error (ValidationError / NotFoundError) that the errorHandler maps to
 * the unified error envelope (Req 8.3, 8.4).
 */
export interface CategoryService {
  createCategoryType(name: string): Promise<CategoryTypeRecord>;
  renameCategoryType(id: string, name: string): Promise<CategoryTypeRecord>;
  deleteCategoryType(id: string): Promise<void>;
  createCategory(
    categoryTypeId: string,
    name: string,
  ): Promise<CategoryRecord>;
  renameCategory(id: string, name: string): Promise<CategoryRecord>;
  deleteCategory(id: string): Promise<void>;
  assignTag(
    studyMaterialId: string,
    categoryId: string,
  ): Promise<TagAssignmentResult>;
  removeTag(studyMaterialId: string, categoryId: string): Promise<void>;
  /**
   * Assign a set of Categories (by name) to a Study Material in one call. Each
   * name is normalized and validated (1–100 chars); an existing Category with
   * that name is reused, otherwise a new Category is auto-created under the
   * default ("General") Category Type. Each resulting Category is tagged onto
   * the material idempotently, respecting the per-material Tag limit. Blank or
   * duplicate names are ignored. Used when creating a Study Material with a
   * flat list of category names.
   */
  applyCategoriesByName(
    studyMaterialId: string,
    names: string[],
  ): Promise<void>;
  /**
   * Assign a set of Categories (by name) scoped to a specific Category Type
   * (resolved/created by its name, e.g. "Subject" or "Job") to a Study
   * Material. Each category name is normalized/validated; an existing Category
   * with that name *within the resolved Category Type* is reused, otherwise a
   * new Category is created under that Category Type. Each resulting Category is
   * tagged onto the material idempotently, respecting the per-material Tag
   * limit. Blank or duplicate names are ignored. Used so an Admin can add
   * Subjects and Jobs the same way as flat Categories.
   */
  applyCategoriesForType(
    studyMaterialId: string,
    categoryTypeName: string,
    names: string[],
  ): Promise<void>;
}
