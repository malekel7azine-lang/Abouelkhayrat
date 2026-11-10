import type { NextApiRequest, NextApiResponse } from "next";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getTask, listTasks } from "@/lib/tasks";

export const config = {
  api: { bodyParser: false },
};

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
  const server = new McpServer({ name: "mcp-media-generator", version: "1.0.0" });

  server.tool("generate_image", "Generate an image. Provider execution is not enabled until provider adapters are configured.", {
    prompt: z.string().min(1),
    model: z.string().optional(),
    aspect_ratio: z.string().optional()
  }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Image generation is not configured yet. Provider adapter implementation is pending." }]
  }));

  server.tool("generate_video", "Generate a video. Provider execution is not enabled until provider adapters are configured.", {
    prompt: z.string().min(1),
    model: z.string().optional(),
    duration: z.number().int().positive().optional()
  }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Video generation is not configured yet. Provider adapter implementation is pending." }]
  }));

  server.tool("merge_videos", "Merge up to 10 video clips using the configured external merger service.", {
    clips: z.array(z.string().url()).min(2).max(10)
  }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Video merging is not configured yet. Merger adapter implementation is pending." }]
  }));

  server.tool("get_task", "Retrieve a task by its task ID.", {
    task_id: z.string().min(1)
  }, async ({ task_id }) => {
    try {
      const task = await getTask(task_id);
      return { content: [{ type: "text", text: task ? JSON.stringify(task) : JSON.stringify({ error: "TASK_NOT_FOUND" }) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Task storage is unavailable." }] };
    }
  });

  server.tool("list_media", "List recent media generation tasks.", {
    limit: z.number().int().min(1).max(100).optional()
  }, async ({ limit }) => {
    try {
      const tasks = await listTasks(limit ?? 30);
      return { content: [{ type: "text", text: JSON.stringify({ items: tasks }) }] };
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
