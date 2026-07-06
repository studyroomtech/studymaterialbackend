-- Rename the classification value model/table Category -> Tag, and the former
-- Tag join table -> MaterialTag (with its categoryId column -> tagId). The
-- CategoryType dimension is unchanged. These are pure renames that preserve all
-- existing rows and relationships.

-- 1. Rename the existing join table Tag -> MaterialTag and its FK column.
ALTER TABLE "Tag" RENAME TO "MaterialTag";
ALTER TABLE "MaterialTag" RENAME COLUMN "categoryId" TO "tagId";

-- 2. Rename the Category value table -> Tag (the name is now free).
ALTER TABLE "Category" RENAME TO "Tag";
