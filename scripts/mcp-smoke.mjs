const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const token = process.env.MCP_AUTH_TOKEN || "ci-placeholder";
const protocolVersion = "2025-03-26";

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) {
        const health = await response.json();
        if (health.status === "ok" && health.database === "connected") return;
      }
    } catch { /* Next.js server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Health endpoint did not become ready");
}

async function rpc(payload, initialized = false) {
  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };
  if (initialized) headers["MCP-Protocol-Version"] = protocolVersion;
  const response = await fetch(base + "/mcp", { method: "POST", headers, body: JSON.stringify(payload) });
  const body = await response.text();
  if (!response.ok) throw new Error("MCP HTTP " + response.status + ": " + body.slice(0, 500));
  const dataLine = body.split(/\r?\n/).find(line => line.startsWith("data: "));
  if (!dataLine) throw new Error("MCP response did not contain an SSE data event: " + body.slice(0, 500));
  return JSON.parse(dataLine.slice(6));
}

function toolText(response) {
  const text = response?.result?.content?.find(item => item.type === "text")?.text;
  if (!text) throw new Error("Tool response did not contain text content");
  return JSON.parse(text);
}

await waitForServer();

const initialized = await rpc({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "mcp-media-generator-ci", version: "1.0.0" }
  }
});
if (initialized?.result?.protocolVersion !== protocolVersion) throw new Error("MCP initialize returned an unexpected protocol version");

const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, true);
const toolNames = (listed?.result?.tools || []).map(tool => tool.name);
for (const name of ["generate_image", "generate_video", "merge_videos", "get_task", "list_media"]) {
  if (!toolNames.includes(name)) throw new Error("Missing MCP tool: " + name);
}

const generated = await rpc({
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "generate_image", arguments: { prompt: "CI smoke test only; no provider keys are configured." } }
}, true);
const createdTask = toolText(generated);
if (!createdTask.task_id || createdTask.status !== "processing") throw new Error("Image task did not enter the expected pending state");

const fetched = await rpc({
  jsonrpc: "2.0", id: 4, method: "tools/call",
  params: { name: "get_task", arguments: { task_id: createdTask.task_id } }
}, true);
const task = toolText(fetched);
if (task.id !== createdTask.task_id || task.status !== "processing") throw new Error("get_task did not preserve the pending task ID/status");

const media = await rpc({
  jsonrpc: "2.0", id: 5, method: "tools/call",
  params: { name: "list_media", arguments: { limit: 5 } }
}, true);
const mediaList = toolText(media);
if (!Array.isArray(mediaList.items) || !mediaList.items.some(item => item.id === createdTask.task_id)) {
  throw new Error("list_media did not include the created task");
}

console.log("MCP smoke test passed: initialize, tools/list, generate_image pending state, get_task, list_media.");
