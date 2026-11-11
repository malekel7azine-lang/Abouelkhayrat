# Merger API v2 — Turso + Vercel

Standalone FFmpeg video-merging API deployed as a Vercel Container Function.

## Runtime architecture

- FFmpeg runs inside the Vercel container image.
- Turso (libSQL) stores job state, progress, errors, Blob pathname, and expiry.
- Vercel Blob **private storage** stores completed MP4 files.
- Download URLs are HMAC-signed, expire after one hour, and are refreshed whenever the job status is queried.
- Jobs and stored videos expire after 24 hours. Expired Blob files are removed opportunistically when new jobs are created or jobs are queried.
- Processing is awaited by `POST /api/jobs/:id/process`; no detached background process or in-memory job state is used.

## API

- `GET /health`
- `POST /api/jobs` with `{"videos":["https://...","https://..."]}` returns a job ID.
- `POST /api/jobs/:jobId/process` claims and processes the job.
- `GET /api/jobs/:jobId` returns status, progress, and a refreshed signed download URL.
- `GET /api/jobs/:jobId/download?expires=...&sig=...` streams the private MP4. This route uses a signed URL; all other API routes require `Authorization: Bearer <MERGER_API_TOKEN>`.

## Limits

- 2–10 public HTTP(S) source URLs.
- Maximum 150 MB per source clip and 500 MB combined.
- Output: H.264/AAC MP4, 1080p maximum, 30 fps, CRF 18.
- Maximum output duration: one hour.
- Job/file retention: 24 hours.
- Vercel Hobby Functions have a 300-second maximum invocation duration. Large or long-running jobs may time out; use a suitable paid plan or a dedicated worker for production workloads beyond that limit.

## Vercel setup

Create a separate Vercel project linked to the existing GitHub repository and set its Root Directory to `merger-service`. Choose the **Container** framework/preset (not Other), because this directory contains `Dockerfile.vercel`.

Create a **private** Vercel Blob store connected to this project. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project automatically.

Set these environment variables for Production (and Preview if required):

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `MERGER_API_TOKEN` (same value as the MCP project's `MERGER_API_TOKEN`)

## Turso

Create the database named `video-merger`, then create a database auth token. The service creates its `merger_jobs` table automatically on first health check.

