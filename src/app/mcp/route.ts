import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { getTask, listTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch {
    return new Response("MCP request failed", { status: 500 });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  return new Response("MCP Streamable HTTP endpoint. Send an MCP request using POST.", {
    status: 405,
    headers: { Allow: "POST" }
  });
}

export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}