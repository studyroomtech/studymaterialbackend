-- A Payment can now cover multiple Paid Materials (a cart): replace the single
-- `studyMaterialId` foreign key with a `studyMaterialIds` text array, and allow
-- a single Payment to grant multiple Entitlements (drop the unique on
-- Entitlement.paymentId). Existing rows are preserved: each Payment's single id
-- becomes a one-element array.

-- 1. Payment: add the array column, backfill from the existing single id.
ALTER TABLE "Payment" ADD COLUMN "studyMaterialIds" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "Payment"
  SET "studyMaterialIds" = ARRAY["studyMaterialId"]
  WHERE "studyMaterialId" IS NOT NULL;

-- 2. Payment: drop the old single-material FK, index, and column.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_studyMaterialId_fkey";
DROP INDEX IF EXISTS "Payment_studyMaterialId_idx";
ALTER TABLE "Payment" DROP COLUMN "studyMaterialId";

-- 3. Drop the array default now that existing rows are backfilled; the app
--    always supplies the value on insert.
ALTER TABLE "Payment" ALTER COLUMN "studyMaterialIds" DROP DEFAULT;

-- 4. Entitlement: a single Payment may now grant many Entitlements, so the
--    paymentId is no longer unique. Add a plain index for lookups.
DROP INDEX IF EXISTS "Entitlement_paymentId_key";
CREATE INDEX IF NOT EXISTS "Entitlement_paymentId_idx" ON "Entitlement"("paymentId");
