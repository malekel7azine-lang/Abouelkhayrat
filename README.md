# MCP Media Generator

Next.js application exposing image generation, video generation, video merging, and media task management through an MCP Streamable HTTP endpoint, with an Arabic RTL administration dashboard.

## Stack

- Next.js 15 App Router + TypeScript
- Official Model Context Protocol SDK (Streamable HTTP)
- Turso / libSQL
- Pollinations, Kie.ai and CometAPI provider adapters
- Integrated FFmpeg video merge engine with Turso BLOB storage

## Environment

Configure these values in Vercel (never commit real credentials):

- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `MCP_AUTH_TOKEN` (required to protect the MCP endpoint)
- `ADMIN_API_TOKEN` (optional; defaults to MCP_AUTH_TOKEN for dashboard administration)
- `API_KEY_ENCRYPTION_SECRET` (optional dedicated AES-256 key; defaults to the Turso auth token)
- `POLLINATIONS_KEY` (or `POLLINATIONS_API_KEY`), `KIE_API_KEY`, `COMETAPI_API_KEY` (optional provider keys; Pollinations is attempted first, then Kie.ai and CometAPI)
- Optional model/base URL overrides are listed in `.env.example`.

Provider keys entered through the dashboard are encrypted with AES-256-GCM before being stored in Turso and are never returned by the API; only masked hints are displayed. Set `API_KEY_ENCRYPTION_SECRET` before adding provider keys if you want a dedicated encryption secret; otherwise the Turso auth token is used as the stable fallback. Do not change the encryption secret after saving keys unless you first re-encrypt the stored keys. Keep database credentials and provider keys private.

## MCP endpoint

`/mcp`

Tools: `generate_image`, `generate_video`, `generate_video_batch`, `merge_videos`, `get_task`, and `list_media`.

Generation is asynchronous. The initial call returns a task ID. Use `get_task` to refresh provider state and retrieve completed results. When all provider keys are temporarily unavailable, the task remains processing and can be retried after approximately 45 seconds using the same task ID.

## Provider behavior

- Pollinations uses `POST /v1/images/generations` for images and `GET /video/{prompt}` with `Prefer: respond-async`, then polls `GET /v1/jobs/{id}` for videos. Configure `POLLINATIONS_KEY` in Vercel; the integration also accepts the legacy exact spelling `Pollinations_key`.
- Kie.ai uses `POST /api/v1/jobs/createTask` and `GET /api/v1/jobs/recordInfo?taskId=...`.
- CometAPI image generation uses `POST /v1/images/generations` (default model `gpt-image-2.6-flare`); Grok Imagine Video 1.5 uses `POST /grok/v1/videos/generations` and polls `GET /grok/v1/videos/{request_id}` (default model `grok-imagine-video-1.5`).
- API keys are attempted in `created_at ASC, id ASC` order. Unauthorized keys are disabled; insufficient-credit keys are marked exhausted but remain retryable; temporary failures fall through to the next key; parameter errors stop the attempt.

## Local development

```bash
npm install
npm run typecheck
npm run build
npm run dev:local
```

## Deployment

Connect this repository to Vercel and configure the environment variables above. Never commit `.env`, provider credentials, database tokens, or GitHub access tokens.


## استوديو دمج الفيديوهات (Turso + FFmpeg)

افتح `/merge.html` من لوحة التطبيق أو استخدم واجهة REST التالية. تعمل الواجهة ومحرك الدمج داخل المشروع نفسه، وتُحفظ بيانات المهام وملفات المصادر والناتج في جداول Turso مقسمة إلى BLOBs.

### المسارات العامة

| Method | Endpoint | الوظيفة |
|---|---|---|
| POST | `/api/jobs` | إنشاء مهمة من `videos[]` أو `sources[]` |
| POST | `/api/upload?job=<id>&seq=<n>&chunk=<k>` | رفع جزء ثنائي حتى 4MB |
| POST | `/api/jobs/<id>/process` | تنفيذ FFmpeg |
| GET | `/api/jobs/<id>` | الحالة والتقدم والنتيجة |
| GET | `/api/jobs/<id>/video` | تشغيل الفيديو وطلبات Range |
| DELETE | `/api/jobs/<id>` | حذف المهمة وبياناتها |
| GET | `/api/config` | حدود الخدمة |
| GET | `/api/merge-health` | فحص Turso وFFmpeg بعد النشر |
| GET | `/api/cron` | تنظيف المهام المنتهية (Vercel Cron) |

### مثال سريع

```bash
curl -X POST https://YOUR-DOMAIN/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"videos":["https://cdn.example/a.mp4","https://cdn.example/b.mp4"]}'
```

استخدم `jobId` الناتج في:
```bash
curl -X POST https://YOUR-DOMAIN/api/jobs/JOB_ID/process
curl https://YOUR-DOMAIN/api/jobs/JOB_ID
curl -H 'Range: bytes=0-1048575' https://YOUR-DOMAIN/api/jobs/JOB_ID/video -o preview.mp4
curl -L 'https://YOUR-DOMAIN/api/jobs/JOB_ID/video?download=1' -o merged.mp4
curl -X DELETE https://YOUR-DOMAIN/api/jobs/JOB_ID
```

### متغيرات البيئة

| المتغير | الافتراضي | الوصف |
|---|---:|---|
| `TURSO_DATABASE_URL` | — | رابط قاعدة Turso (إلزامي) |
| `TURSO_AUTH_TOKEN` | — | رمز Turso (إلزامي) |
| `MAX_SOURCES` | 10 | أقصى عدد مصادر |
| `SOURCE_MAX_MB` | 200 | الحد الأقصى لكل مصدر |
| `OUTPUT_MAX_MB` | 150 | الحد الأقصى للناتج |
| `MAX_TOTAL_DURATION_SEC` | 600 | مجموع المدد |
| `FFMPEG_PRESET` | medium | إعداد سرعة/ضغط H.264 |
| `CRON_SECRET` | — | حماية استدعاء cron عند ضبطه |

### حدود تشغيل مهمة

- دالة Vercel مضبوطة على `maxDuration: 300`، لكن هذا لا يعني أن كل حساب أو خطة يسمحان بخمس دقائق؛ سقف التنفيذ الفعلي تابع لخطة Vercel وإعداداتها.
- FFmpeg يعمل داخل دالة Serverless ويستهلك CPU وذاكرة ووقت تنفيذ. عمليات الدمج الطويلة أو الكبيرة قد تتجاوز سقف المنصة وتفشل؛ لا يُعد هذا بديلاً مضموناً عن عامل معالجة دائم.
- كل طلب رفع مقسم إلى أجزاء 4MB، ثم تحفظ الأجزاء في صفوف Turso بحجم 2MB. الناتج يقسم أيضاً إلى 2MB.
- الفيديو الناتج يستهلك مساحة قاعدة Turso وعمليات كتابة/قراءة؛ راجع حصة قاعدة البيانات وخطة Turso الحالية قبل رفع ملفات كبيرة.
- مدة الاحتفاظ 24 ساعة، لكن التنظيف الفعلي يعتمد على الطلبات اللاحقة أو Cron. لا توجد ضمانة حذف لحظية عند تعطل Cron.
- واجهة الدمج تقبل روابط عامة. لا ترسل روابط خاصة أو روابط تتطلب جلسة دخول.
- لا تضع أسرار Turso في المستودع. أضف المتغيرين في Vercel Project Settings → Environment Variables ثم أعد النشر.

### التكامل مع MCP

أداة `merge_videos` تنشئ مهمة دمج مستقلة من روابط عامة. أداة `generate_video_batch` تنفذ سلسلة توليد ثم دمج تلقائي.

### توليد عدة مقاطع ودمجها تلقائياً عبر MCP

أضيفت أداة `generate_video_batch`: ترسل لها مصفوفة مرتبة من 2 إلى 10 أوصاف، فينشئ التطبيق مهام الفيديو الفرعية، ويتابعها عبر `get_task`. عندما تكتمل جميع المقاطع، يستخرج روابطها بالترتيب نفسه ويبدأ مهمة الدمج تلقائياً. إذا فشل أي مقطع، تتوقف السلسلة ولا يتم إنتاج فيديو ناقص. استخدم `get_task` على معرّف المهمة الأب حتى تصل الحالة إلى `completed` أو `failed`.

### حدود الخطط المجانية (تحقق: نوفمبر 2026)

- **Vercel Functions:** مع Fluid Compute، الحد الأقصى المعلن لخطة Hobby هو 300 ثانية لكل استدعاء، والذاكرة القصوى 2GB. إذا كان Fluid Compute معطلاً، يكون سقف Hobby أقل (60 ثانية). معالجة الفيديو تستهلك CPU وذاكرة، وقد تتجاوز الحصة المجانية للاستخدام إذا زاد حجم التشغيل.
- **Vercel request body:** الحد الأقصى 4.5MB؛ لذلك تعتمد الواجهة أجزاء 4MB. الحد القياسي لحجم Function غير المضغوط 250MB، وتُضمّن ملفات FFmpeg عبر output tracing.
- **Turso Free:** 5GB تخزين، و500 مليون صف مقروء، و10 ملايين صف مكتوب شهرياً، حتى 100 قاعدة بيانات. كل جزء فيديو محفوظ كصف BLOB مستقل؛ راقب مساحة التخزين وعدد الصفوف المكتوبة.
- لا يوجد Render أو Vercel Blob أو S3 أو خدمة معالجة خارجية في مسار الدمج الحالي.

المراجع الرسمية: [Vercel Function limits](https://vercel.com/docs/functions/limitations) · [Vercel duration](https://vercel.com/docs/functions/configuring-functions/duration) · [Turso pricing](https://turso.tech/pricing)
