-- Removes the linked-materials feature: drops the Link Group foreign key,
-- index and column from "StudyMaterial", then the "MaterialLinkGroup" table.

-- DropForeignKey
ALTER TABLE "StudyMaterial" DROP CONSTRAINT "StudyMaterial_linkGroupId_fkey";

-- DropIndex
DROP INDEX "StudyMaterial_linkGroupId_idx";

-- AlterTable
ALTER TABLE "StudyMaterial" DROP COLUMN "linkGroupId";

-- DropTable
DROP TABLE "MaterialLinkGroup";
