# Backend

Node.js + Express + TypeScript + Prisma backend for the Study Materials Platform.

## Deployment

The backend runs as **two Railway services in the same project**, both built from this
`backend` image but with different start commands and deploy settings.

### 1. Web service (`railway.json`)

The primary HTTP API. Runs migrations on release, starts the Express server, and is
health-checked. This is the existing `railway.json` config — do not repurpose it for the
cron job.

### 2. Payment Reconciliation Cron service (`railway.cron.json`)

A second Railway service that schedules the one-shot Payment Reconciliation Job
(`src/jobs/reconcilePayments.ts`). It selects a batch of stale `created` Payment Records,
queries Razorpay for the true order state, settles each record idempotently, and exits.

`railway.cron.json` is a **sample/reference config** for setting up this second service
(either by pointing the service at this file or by entering the equivalent values in the
Railway dashboard). It is not consumed automatically alongside `railway.json`.

Recommended configuration:

| Setting              | Value                | Notes                                                                                     |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `cronSchedule`       | `*/30 * * * *`       | Every 30 minutes. The 10-minute Grace Window ensures the job never races an in-flight verify. |
| `startCommand`       | `npm run reconcile`  | Runs the compiled one-shot script; the process exits when the batch completes.            |
| `restartPolicyType`  | `NEVER`              | A cron run should not be restarted on exit; Railway triggers the next run on schedule. A non-zero exit surfaces as a failed run. |
| healthcheck          | _none_               | The job is not a long-running server, so there is no health endpoint to check.            |
| `preDeployCommand`   | _none_               | Migrations are owned by the web service's `release` step; the cron service must **not** run `prisma migrate deploy`. |

#### Shared variables

The cron service reuses the same shared Railway variables as the web service:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` (still required by the shared `loadEnv`)
- `DATABASE_URL` — points at the same database as the web service

#### Optional reconciliation tuning variables

These are optional and fall back to their defaults (with a logged notice) when omitted:

- `RECONCILE_GRACE_WINDOW_MINUTES` — default `10` (bounds 1–1440)
- `RECONCILE_FAIL_AFTER_WINDOW_HOURS` — default `24` (bounds 1–168)
- `RECONCILE_BATCH_SIZE` — default `100` (bounds 1–1000)
