-- CreateEnum
CREATE TYPE "TestTimingMode" AS ENUM ('overall', 'sectional');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('in_progress', 'paused', 'completed');

-- DropForeignKey
ALTER TABLE "Entitlement" DROP CONSTRAINT "Entitlement_studyMaterialId_fkey";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "sectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "testIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "testId" TEXT,
ALTER COLUMN "studyMaterialId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "timingMode" "TestTimingMode" NOT NULL,
    "timeLimitSeconds" INTEGER NOT NULL,
    "priceAmount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "timeLimitSeconds" INTEGER NOT NULL,
    "correctMarkCenti" INTEGER NOT NULL,
    "negativeMarkCenti" INTEGER NOT NULL,
    "priceAmount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Option" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "Option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "scopedSectionId" TEXT,
    "status" "AttemptStatus" NOT NULL DEFAULT 'in_progress',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "accumulatedActiveSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastResumedAt" TIMESTAMP(3),
    "scoreCentimarks" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionAttempt" (
    "id" TEXT NOT NULL,
    "testAttemptId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'in_progress',
    "startedAt" TIMESTAMP(3),
    "accumulatedActiveSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastResumedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SectionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" TEXT NOT NULL,
    "testAttemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOptionIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Test_createdAt_idx" ON "Test"("createdAt");

-- CreateIndex
CREATE INDEX "Section_testId_idx" ON "Section"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_testId_orderIndex_key" ON "Section"("testId", "orderIndex");

-- CreateIndex
CREATE INDEX "Question_sectionId_idx" ON "Question"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_sectionId_orderIndex_key" ON "Question"("sectionId", "orderIndex");

-- CreateIndex
CREATE INDEX "Option_questionId_idx" ON "Option"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Option_questionId_orderIndex_key" ON "Option"("questionId", "orderIndex");

-- CreateIndex
CREATE INDEX "TestAttempt_userId_testId_idx" ON "TestAttempt"("userId", "testId");

-- CreateIndex
CREATE INDEX "TestAttempt_userId_status_idx" ON "TestAttempt"("userId", "status");

-- CreateIndex
CREATE INDEX "SectionAttempt_testAttemptId_idx" ON "SectionAttempt"("testAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionAttempt_testAttemptId_sectionId_key" ON "SectionAttempt"("testAttemptId", "sectionId");

-- CreateIndex
CREATE INDEX "Response_testAttemptId_idx" ON "Response"("testAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_testAttemptId_questionId_key" ON "Response"("testAttemptId", "questionId");

-- CreateIndex
CREATE INDEX "Entitlement_testId_idx" ON "Entitlement"("testId");

-- CreateIndex
CREATE INDEX "Entitlement_sectionId_idx" ON "Entitlement"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_userId_testId_key" ON "Entitlement"("userId", "testId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_userId_sectionId_key" ON "Entitlement"("userId", "sectionId");

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_studyMaterialId_fkey" FOREIGN KEY ("studyMaterialId") REFERENCES "StudyMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Option" ADD CONSTRAINT "Option_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAttempt" ADD CONSTRAINT "SectionAttempt_testAttemptId_fkey" FOREIGN KEY ("testAttemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAttempt" ADD CONSTRAINT "SectionAttempt_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_testAttemptId_fkey" FOREIGN KEY ("testAttemptId") REFERENCES "TestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

