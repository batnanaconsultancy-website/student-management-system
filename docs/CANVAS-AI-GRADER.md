# Canvas AI Grader implementation notes

This feature is additive to the existing Canvas integration and the existing
Examiner workflow. It is intended to be merged and applied only after review;
no production database or deployment changes were made as part of this work.

## Scope configuration

- The Admin Canvas page now has an **Assessment Setup** tab.
- Course discovery uses the configured Canvas account endpoint and caches all
  courses visible to the configured token. `CANVAS_EXTRA_COURSE_IDS` is no
  longer required.
- Course discovery does not classify courses. Admins explicitly enable a
  course in either `canvas_bachelor` or `canvas_masters`.
- The 10 existing Masters course IDs (201, 328, 385, 421, 427, 432, 434,
  443, 447, 548) are seeded into the Masters scope. Their existing assignments
  are seeded as assessment assignments. The Bachelor picker offers the other
  195 discovered courses and does not select any assignment by default.
- New assignments remain excluded until an Admin explicitly selects them.
- Course and assignment selection changes are written to
  `canvas_assessment_config_audit`.
- Admins assign active teaching Examiners to the Bachelor and/or Masters
  scope. This is independent of Final Project assignment links.

## Evidence and grading workflow

- The existing `canvas_submissions` table remains the legacy current-state
  projection.
- Sync now requests Canvas submission history and stores per-attempt evidence
  in `canvas_submission_attempts`.
- Assignment rubric definitions are stored as versioned snapshots.
- Attachment metadata is preserved. Files up to 50 MiB are downloaded into the
  private `canvas-submission-evidence` Storage bucket. If a file cannot be
  downloaded or exceeds the limit, its metadata records the reason rather than
  silently claiming the file was archived.
- AI grading requests are idempotently enqueued in `canvas_ai_grading_jobs`.
  The OpenAI worker claims jobs through a PostgreSQL `FOR UPDATE SKIP LOCKED`
  function, so concurrent worker invocations do not claim the same job.
- The worker uses the OpenAI Responses API with strict JSON Schema output, a
  90-second request timeout, and validates that every rubric criterion is
  scored exactly once and within its maximum. It stores criterion-level score,
  evidence, feedback and confidence. Refusals and incomplete outputs are not
  retried; transient network, rate-limit and server errors use queue retries.
- Results are stored separately from Examiner reviews. The worker never writes
  an approved grade or publishes to Canvas.
- Examiner review records remain separate and approval does not publish a
  grade. Only the explicit **Publish approved grade to Canvas** action calls
  the Canvas gradebook update API.
- AI jobs retry with exponential backoff, retain the last error, and can be
  reclaimed after a worker lease expires. Result persistence and job completion
  happen in one lease-checked database transaction, preventing an expired worker
  from overwriting a newer worker's result. Failed jobs remain visible for
  diagnosis. Canvas sync and AI grading continue to use separate queues.
- The worker currently grades captured submission text. Attachment metadata is
  passed as metadata only; the worker does not claim to have read file contents.
  Attachment-only submissions are sent to manual Examiner review instead of
  being scored from filenames.

## OpenAI worker configuration

Server-only environment variables:

```dotenv
OPENAI_API_KEY=your-server-side-api-key
OPENAI_MODEL=gpt-6.2-sol
CANVAS_AI_WORKER_SECRET=generate-a-long-random-secret
```

`gpt-6.2-sol` is the default model. The model can be changed through
`OPENAI_MODEL` without changing application code. Never expose these variables
through `runtimeConfig.public`, browser code, logs, or source control.

The worker endpoint is `POST /api/internal/canvas-ai-grader/worker` and
requires the `x-canvas-ai-worker-secret` header. It processes at most one
eligible job per request. A scheduler must invoke it periodically (for
example, once per minute); the durable database queue retains jobs between
invocations. The worker fails closed when `CANVAS_AI_WORKER_SECRET` is absent.

Example scheduler invocation (run on the VPS; do not put the secret in shell
history or a committed script):

```bash
curl --fail --silent --show-error -X POST \
  -H "x-canvas-ai-worker-secret: $CANVAS_AI_WORKER_SECRET" \
  https://sis.amsterdam.tech/api/internal/canvas-ai-grader/worker
```

The environment variable must be provided securely to the scheduler. This
implementation has not configured a production scheduler or enabled a live
OpenAI request. Tests use mocked Responses API payloads and make no network
calls.

## Migration

The additive migration is:

`migrations/2026-11-28-create-canvas-ai-grader.sql`

It expands `canvas_courses`, creates assessment configuration, evidence,
rubric snapshot, job, AI result, Examiner review and grade-publish tables,
adds scope-aware RLS policies, and creates the private evidence bucket.

This migration has **not** been applied to any database. Apply it manually in
the intended test database first, inspect the resulting RLS and Storage
policies, and only then plan a separately approved production migration.

## Local validation

Run the provider tests without credentials or network access:

```bash
node --test tests/canvas-ai-grader.test.js
```

The tests mock OpenAI Responses API replies and verify rubric coverage, score
bounds, JSON Schema request construction, attachment-only handling, and retry
classification. A full Nuxt build and live Canvas/Supabase integration test
require the project's installed dependencies, test credentials, and a database
with the migration applied.

The OpenAI API model catalogue currently lists `gpt-6.2-sol` as a supported
Responses API model with Structured Outputs. The shorthand `gpt-6` is not the
model ID to place in `OPENAI_MODEL`; update any existing VPS value of
`OPENAI_MODEL=gpt-6` to `OPENAI_MODEL=gpt-6.2-sol` before enabling live grading.
