-- Add a new terminal value to the PaymentStatus enum for records the Payment
-- Reconciliation Job sweeps up: no captured Razorpay payment was found and the
-- record aged past the Fail-After Window. Kept distinct from `failed` (a
-- verification/signature failure) so audits can tell the two apart (Req 5.1).
--
-- Postgres 12+ permits ALTER TYPE ... ADD VALUE outside an explicit transaction;
-- Prisma applies each migration statement directly.
ALTER TYPE "PaymentStatus" ADD VALUE 'system_cancelled_due_to_old_age';
