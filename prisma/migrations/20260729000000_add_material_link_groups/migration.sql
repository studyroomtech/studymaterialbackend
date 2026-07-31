-- AlterTable
ALTER TABLE "StudyMaterial" ADD COLUMN     "linkGroupId" TEXT;

-- CreateTable
CREATE TABLE "MaterialLinkGroup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialLinkGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyMaterial_linkGroupId_idx" ON "StudyMaterial"("linkGroupId");

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_linkGroupId_fkey" FOREIGN KEY ("linkGroupId") REFERENCES "MaterialLinkGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
