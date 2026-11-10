-- CreateTable
CREATE TABLE "MaterialThumbnail" (
    "id" TEXT NOT NULL,
    "studyMaterialId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialThumbnail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialThumbnail_studyMaterialId_idx" ON "MaterialThumbnail"("studyMaterialId");

-- AddForeignKey
ALTER TABLE "MaterialThumbnail" ADD CONSTRAINT "MaterialThumbnail_studyMaterialId_fkey" FOREIGN KEY ("studyMaterialId") REFERENCES "StudyMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
