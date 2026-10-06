-- CreateTable
CREATE TABLE "MaterialFile" (
    "id" TEXT NOT NULL,
    "studyMaterialId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialFile_studyMaterialId_idx" ON "MaterialFile"("studyMaterialId");

-- AddForeignKey
ALTER TABLE "MaterialFile" ADD CONSTRAINT "MaterialFile_studyMaterialId_fkey" FOREIGN KEY ("studyMaterialId") REFERENCES "StudyMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill each pre-existing Study Material's primary file as its first
-- MaterialFile row, so materials uploaded before multi-file support still expose
-- a non-empty file list. The id is derived from the material id: the table is
-- empty at this point and exactly one row is inserted per material, so the
-- derived ids are unique.
INSERT INTO "MaterialFile" (
    "id",
    "studyMaterialId",
    "objectKey",
    "fileName",
    "contentType",
    "fileSizeBytes",
    "orderIndex",
    "createdAt"
)
SELECT
    'mf_' || "id",
    "id",
    "objectKey",
    "fileName",
    "contentType",
    "fileSizeBytes",
    0,
    "createdAt"
FROM "StudyMaterial";
