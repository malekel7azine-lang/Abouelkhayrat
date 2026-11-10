# MCP Media Generator

Next.js application exposing image generation, video generation, video merging, and media task management through an MCP Streamable HTTP endpoint, with an Arabic RTL administration dashboard.

## Stack

- Next.js 15 App Router + TypeScript
- Official Model Context Protocol SDK (Streamable HTTP)
- Turso / libSQL
- Kie.ai and CometAPI provider adapters
- External Merger API v2

## Environment

Configure these values in Vercel (never commit real credentials):

- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `MCP_AUTH_TOKEN` (required to protect the MCP endpoint)
- `ADMIN_API_TOKEN` (optional; defaults to MCP_AUTH_TOKEN for dashboard administration)
- `API_KEY_ENCRYPTION_SECRET` (optional dedicated AES-256 key; defaults to the Turso auth token)
- `KIE_API_KEY`, `COMETAPI_API_KEY` (optional fallback keys; additional ordered keys can be managed in the dashboard)
- `MERGER_API_BASE` and `MERGER_API_TOKEN` (required for authenticated video merging)
- Optional model/base URL overrides are listed in `.env.example`.

Provider keys entered through the dashboard are encrypted with AES-256-GCM before being stored in Turso and are never returned by the API; only masked hints are displayed. Set `API_KEY_ENCRYPTION_SECRET` before adding provider keys if you want a dedicated encryption secret; otherwise the Turso auth token is used as the stable fallback. Do not change the encryption secret after saving keys unless you first re-encrypt the stored keys. Keep database credentials and provider keys private.

## MCP endpoint

`/mcp`

Tools: `generate_image`, `generate_video`, `merge_videos`, `get_task`, and `list_media`.

Generation is asynchronous. The initial call returns a task ID. Use `get_task` to refresh provider state and retrieve completed results. When all provider keys are temporarily unavailable, the task remains processing and can be retried after approximately 45 seconds using the same task ID.

## Provider behavior

- Kie.ai uses `POST /api/v1/jobs/createTask` and `GET /api/v1/jobs/recordInfo?taskId=...`.
- CometAPI image generation uses `POST /v1/images/generations` (default model `gpt-image-2.6-flare`); Grok Imagine Video 1.5 uses `POST /grok/v1/videos/generations` and polls `GET /grok/v1/videos/{request_id}` (default model `grok-imagine-video-1.5`).
- API keys are attempted in `created_at ASC, id ASC` order. Unauthorized keys are disabled; insufficient-credit keys are marked exhausted but remain retryable; temporary failures fall through to the next key; parameter errors stop the attempt.
- Merger API v2 uses `POST /api/jobs` with `{"videos":[...]}`, then calls `POST /api/jobs/{jobId}/process` exactly once after persisting the job ID, and polls `GET /api/jobs/{jobId}`. The service output profile is MP4 (H.264 + AAC), CRF 18, maximum 1080p, with automatic deletion after 24 hours.

## Local development

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Deployment

Connect this repository to Vercel and configure the environment variables above. Never commit `.env`, provider credentials, database tokens, or GitHub access tokens.

## Standalone merger service

The FFmpeg-based Merger API v2 implementation is in `merger-service/`. It supports 2–10 public video URLs, H.264/AAC MP4 output, and 24-hour job/file retention while the service remains running. Deploy it separately from Vercel; Vercel serverless functions are not used for FFmpeg processing. The included Render Blueprint can be used for an integration test, but Render's free tier sleeps after 15 minutes and discards local files on sleep/restart/redeploy. Therefore the free tier cannot guarantee 24-hour availability or retention. For reliable production merging, a continuously running container with persistent storage is required and may incur hosting costs. Set the same `MERGER_API_TOKEN` in Render and Vercel, and set `MERGER_API_BASE` in Vercel to the deployed service origin.
