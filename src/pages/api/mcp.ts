import type { NextApiRequest, NextApiResponse } from "next";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v4";
import { getTaskWithRefresh, publicTask, startMediaTask, startMergeTask } from "@/lib/media-engine";
import { startVideoBatch } from "@/lib/video-batch";

export const config = { api: { bodyParser: false } };

function authorized(req: NextApiRequest): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) return true;
  const header = req.headers.authorization ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createServer() {
  const server = new McpServer({ name: "mcp-media-generator", version: "1.1.0" });

  server.tool("generate_image", "Create an image generation task. Pollinations is tried first when configured, then Kie.ai and CometAPI. Use get_task to retrieve its result.", {
    prompt: z.string().min(1).max(32000),
    model: z.string().optional(),
    aspect_ratio: z.string().optional(),
    resolution: z.enum(["1K", "2K", "4K"]).optional(),
    quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]).optional(),
    output_format: z.enum(["png", "jpeg", "webp"]).optional()
  }, async (args) => {
    try {
      const taskId = await startMediaTask("image", args);
      const task = await getTaskWithRefresh(taskId);
      return { content: [{ type: "text", text: JSON.stringify({ task_id: taskId, status: task?.status || "processing" }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Unable to create image task." }] };
    }
  });

  server.tool("generate_video", "Create a video generation task. Pollinations is tried first when configured, then Kie.ai and CometAPI. Use get_task to retrieve its result.", {
    prompt: z.string().min(1).max(4096),
    model: z.string().optional(),
    duration: z.number().int().min(1).max(15).optional(),
    aspect_ratio: z.string().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).optional(),
    image_urls: z.array(z.string().url()).max(7).optional()
  }, async (args) => {
    try {
      const taskId = await startMediaTask("video", args);
      const task = await getTaskWithRefresh(taskId);
      return { content: [{ type: "text", text: JSON.stringify({ task_id: taskId, status: task?.status || "processing" }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Unable to create video task." }] };
    }
  });

  server.tool("merge_videos", "Create a video merge job from 2 to 10 publicly accessible HTTP(S) video URLs. Output is MP4.", {
    clips: z.array(z.string().url()).min(2).max(10)
  }, async ({ clips }) => {
    try {
      const taskId = await startMergeTask(clips);
      const task = await getTaskWithRefresh(taskId);
      return { content: [{ type: "text", text: JSON.stringify({ task_id: taskId, status: task?.status || "processing" }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Unable to create merge task." }] };
    }
  });

  server.tool("generate_video_batch", "Generate 2 to 10 ordered video clips, wait for all to complete, then automatically merge them into one MP4. Poll with get_task.", {
    prompts: z.array(z.string().min(1).max(4096)).min(2).max(10),
    model: z.string().optional(),
    duration: z.number().int().min(1).max(15).optional(),
    aspect_ratio: z.string().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).optional()
  }, async ({ prompts, ...options }) => {
    try {
      const taskId = await startVideoBatch(prompts, options);
      return { content: [{ type: "text", text: JSON.stringify({ task_id: taskId, status: "processing", pipeline: "generate_then_auto_merge" }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Unable to start video batch pipeline." }] };
    }
  });

  server.tool("get_task", "Retrieve a task by task ID. Processing tasks are refreshed; temporary provider failures are retried after approximately 45 seconds using the same task ID.", {
    task_id: z.string().min(1)
  }, async ({ task_id }) => {
    try {
      const task = await getTaskWithRefresh(task_id);
      return { content: [{ type: "text", text: task ? JSON.stringify(publicTask(task)) : JSON.stringify({ error: "TASK_NOT_FOUND" }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Task storage is unavailable." }] };
    }
  });

  server.tool("list_media", "List recent media generation tasks.", {
    limit: z.number().int().min(1).max(100).optional()
  }, async ({ limit }) => {
    try {
      const { listTasks } = await import("@/lib/tasks");
      const tasks = await listTasks(limit ?? 30);
      return { content: [{ type: "text", text: JSON.stringify({ items: tasks.map(publicTask) }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Media storage is unavailable." }] };
    }
  });

  return server;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).send("Method Not Allowed");
  }
  if (!authorized(req)) return res.status(401).send("Unauthorized");
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).send("MCP request failed");
    else if (!res.writableEnded) res.end();
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
