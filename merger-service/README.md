# Merger API v2

Standalone FFmpeg service implementing the contract used by `src/lib/merger.ts`.

- `GET /health`
- `POST /api/jobs` with `{"videos":["https://...","https://..."]}` returns a job ID
- `POST /api/jobs/:jobId/process` starts the merge once
- `GET /api/jobs/:jobId` returns status and progress
- `GET /api/jobs/:jobId/download` streams the MP4

All routes except health require `Authorization: Bearer <MERGER_API_TOKEN>`. Supports 2–10 public HTTP(S) clips, rejects private IPs, limits each input to 500 MB, outputs H.264/AAC MP4 at 1080p maximum, CRF 18, and expires jobs/files after 24 hours.

Deploy with the Render Blueprint in this directory. Free Render services sleep after 15 minutes and lose local files on sleep/restart/redeploy; this is suitable for integration testing, not dependable 24-hour production retention. See https://render.com/docs/free.
