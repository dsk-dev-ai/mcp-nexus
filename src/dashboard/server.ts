import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ToolRegistry } from "../registry/registry.ts";
import type { NexusRouter } from "../router/index.ts";
import type { PolicyEngine } from "../policy/policy.ts";
import type { ApprovalStore } from "../policy/approvals.ts";
import type { ActivityLog } from "../telemetry/logger.ts";
import type { ToolExecutor } from "../executor/executor.ts";
import type { NexusConfig } from "../config.ts";

export interface DashboardDeps {
  registry: ToolRegistry;
  router: NexusRouter;
  policy: PolicyEngine;
  approvals: ApprovalStore;
  activity: ActivityLog;
  executor: ToolExecutor;
  config: NexusConfig;
}

export interface DashboardServerHandle {
  close: () => Promise<void>;
  port: number;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Minimal functional dashboard + REST API. No runtime dependencies — the
 * Node http module serves a single-page app backed by JSON endpoints.
 * Binds to 127.0.0.1 only; not intended to be exposed publicly.
 */
export async function startDashboard(deps: DashboardDeps): Promise<DashboardServerHandle> {
  const port = Number(deps.config.port ?? 3000);

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    try {
      if (method === "GET" && path === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE);
        return;
      }

      // ---- API ----
      if (method === "GET" && path === "/api/health") {
        json(res, 200, {
          status: "ok",
          version: "0.5.0",
          uptime: Math.round(process.uptime()),
          tools: deps.registry.list().length,
        });
        return;
      }

      if (method === "GET" && path === "/api/summary") {
        const summary = deps.activity.summary();
        const tools = deps.registry.list();
        const enabled = tools.filter((t) => t.enabled).length;
        json(res, 200, {
          tools: tools.length,
          enabled,
          calls: summary.total,
          successRate: summary.total
            ? Math.round((100 * (summary.byStatus.success ?? 0)) / summary.total * 100) / 100
            : 100,
          avgLatencyMs: summary.avgDurationMs,
          byTool: summary.byTool,
          byStatus: summary.byStatus,
          pendingApprovals: deps.approvals.list().length,
        });
        return;
      }

      if (method === "GET" && path === "/api/tools") {
        const summary = deps.activity.summary();
        const tools = deps.registry.list().map((t) => {
          const execs = summary.byTool[t.name] ?? 0;
          return {
            name: t.name,
            version: t.version,
            enabled: t.enabled,
            transport: t.transport.type,
            capabilities: t.capabilities,
            description: t.description,
            executions: execs,
            health: !t.enabled ? "disabled" : execs > 0 ? "healthy" : "idle",
          };
        });
        json(res, 200, tools);
        return;
      }

      if (method === "POST" && path.startsWith("/api/tools/") && path.endsWith("/enable")) {
        const name = decodeURIComponent(path.slice("/api/tools/".length, -"/enable".length));
        const body = await readBody(req);
        const enabled = Boolean(body.enabled);
        try {
          const entry = deps.registry.setEnabled(name, enabled);
          json(res, 200, { name, enabled: entry.enabled });
        } catch (error) {
          json(res, 404, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (method === "GET" && /^\/api\/tools\/[^/]+$/.test(path)) {
        const name = decodeURIComponent(path.slice("/api/tools/".length));
        const tool = deps.registry.get(name);
        if (!tool) {
          json(res, 404, { error: `tool "${name}" not found` });
          return;
        }
        json(res, 200, tool);
        return;
      }

      if ((method === "GET" || method === "POST") && path === "/api/route") {
        if (method === "GET") {
          const query = url.searchParams.get("query") ?? "";
          if (!query) {
            json(res, 400, { error: "query parameter required" });
            return;
          }
          const decision = await deps.router.route(query, deps.registry.enabled());
          json(res, 200, presentDecision(decision, query));
          return;
        }
        const body = await readBody(req);
        const query = String(body.query ?? "");
        const decision = await deps.router.route(query, deps.registry.enabled());
        json(res, 200, presentDecision(decision, query));
        return;
      }

      if (method === "GET" && path === "/api/activity") {
        json(res, 200, {
          summary: deps.activity.summary(),
          recent: deps.activity.recent(25),
        });
        return;
      }

      if (method === "GET" && path === "/api/policies") {
        json(res, 200, deps.policy.snapshot);
        return;
      }

      if (method === "GET" && path === "/api/approvals") {
        json(res, 200, deps.approvals.list());
        return;
      }

      if (method === "POST" && /^\/api\/approvals\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.slice("/api/approvals/".length));
        const body = await readBody(req);
        const approved = Boolean(body.approved);
        const resolved = deps.approvals.resolve(id, approved);
        if (!resolved) {
          json(res, 404, { error: `no pending approval "${id}"` });
          return;
        }
        json(res, 200, { id, tool: resolved.tool, approved });
        return;
      }

      if (method === "GET" && path === "/api/config") {
        json(res, 200, maskedConfig(deps.config));
        return;
      }

      if (method === "GET" && path === "/api/benchmark") {
        const result = await runBenchmark(deps);
        json(res, 200, result);
        return;
      }

      json(res, 404, { error: `no route for ${method} ${path}` });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    port: (server.address() as { port: number }).port,
  };
}

function presentDecision(decision: Awaited<ReturnType<NexusRouter["route"]>>, query: string) {
  return {
    query,
    selected: decision.tool?.name ?? null,
    provider: decision.provider,
    confidence: decision.confidence,
    matchedCapabilities: decision.matchedCapabilities,
    alternatives: decision.alternatives,
    explanation: decision.explanation,
  };
}

function maskedConfig(config: NexusConfig): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...config };
  delete (masked as Record<string, unknown>).home;
  delete (masked as Record<string, unknown>).openrouterApiKey;
  delete (masked as Record<string, unknown>).geminiApiKey;
  (masked as Record<string, unknown>).openrouterApiKey = config.openrouterApiKey ? "****" : undefined;
  (masked as Record<string, unknown>).geminiApiKey = config.geminiApiKey ? "****" : undefined;
  return masked;
}

async function runBenchmark(deps: DashboardDeps): Promise<unknown> {
  const { success, accuracy, tasks, results } = await dashBenchmark(deps);
  return { tools: deps.registry.list().length, tasks, accuracy, success, results };
}

export async function dashBenchmark(deps: DashboardDeps): Promise<{
  success: boolean;
  accuracy: number;
  tasks: number;
  results: Array<{ query: string; expected: string; got: string | null; provider: string; correct: boolean; ms: number }>;
}> {
  const catalog = deps.registry.enabled();
  const tasks = benchmarkTasks();
  const results = [];
  for (const task of tasks) {
    const start = Date.now();
    const decision = await deps.router.route(task.query, catalog);
    results.push({
      query: task.query,
      expected: task.expected,
      got: decision.tool?.name ?? null,
      provider: decision.provider,
      correct: decision.tool?.name === task.expected,
      ms: Date.now() - start,
    });
  }
  const correct = results.filter((r) => r.correct).length;
  return {
    success: correct === results.length,
    accuracy: Math.round((100 * correct) / results.length),
    tasks: results.length,
    results,
  };
}

function benchmarkTasks(): Array<{ query: string; expected: string }> {
  return [
    ["diagram my repository architecture", "repoarch"],
    ["what does my project structure look like", "repoarch"],
    ["check for vulnerable dependencies", "dependency-audit"],
    ["are my npm packages secure", "dependency-audit"],
    ["find leaked secrets in this repo", "secret-scanner"],
    ["scan for API keys", "secret-scanner"],
    ["pack this codebase into one file", "ctx"],
    ["make a single context file for my LLM", "ctx"],
    ["check my env variables are set", "env-proof"],
    ["validate configuration for node", "env-proof"],
    ["show me recent git commits", "git-inspector"],
    ["who changed this file last", "git-inspector"],
    ["analyze my repository structure and then check dependencies", "repoarch"],
  ].map(([query, expected]) => ({ query: query!, expected: expected! }));
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP Nexus</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#e6edf3;--muted:#8b949e;--green:#3fb950;--red:#f85149;--yellow:#d29922;--blue:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:14px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg)}
header h1{font-size:16px;margin:0}
header .tag{color:var(--muted);font-size:12px}
nav{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
nav button{background:none;border:1px solid transparent;color:var(--muted);padding:6px 10px;border-radius:6px;cursor:pointer}
nav button.active{color:var(--fg);border-color:var(--border);background:var(--panel)}
main{padding:20px 24px;max-width:1100px;margin:0 auto}
section{display:none}
section.active{display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px}
.card .k{color:var(--muted);font-size:12px}
.card .v{font-size:22px;font-weight:600;margin-top:4px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px}
th{color:var(--muted);font-weight:500;background:#0f1419}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px}
.ok{background:rgba(63,185,80,.15);color:var(--green)}
.err{background:rgba(248,81,73,.15);color:var(--red)}
.warn{background:rgba(210,153,34,.2);color:var(--yellow)}
.idle{background:rgba(139,148,158,.15);color:var(--muted)}
.muted{color:var(--muted)}
button{padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--fg);cursor:pointer;font-size:13px}
button:hover{border-color:var(--blue)}
button.primary{background:var(--blue);border-color:var(--blue);color:#fff}
input[type=text]{padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--fg);width:min(420px,100%)}
pre{background:#0f1419;border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto;font-size:12px}
.flex{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.row{display:flex;gap:14px;flex-wrap:wrap}
.ex{margin:6px 0;padding:8px 10px;background:#0f1419;border:1px solid var(--border);border-radius:8px;font-size:13px}
</style>
</head>
<body>
<header>
  <h1>MCP Nexus <span class="tag">0.5.0</span></h1>
  <nav>
    <button data-sec="overview" class="active">Overview</button>
    <button data-sec="tools">Tools</button>
    <button data-sec="router">Router</button>
    <button data-sec="activity">Activity</button>
    <button data-sec="approvals">Approvals</button>
    <button data-sec="policies">Policies</button>
    <button data-sec="benchmark">Benchmark</button>
    <button data-sec="settings">Settings</button>
  </nav>
</header>
<main>
  <section id="overview" class="active"><div class="cards" id="sumcards"></div><div class="row"><div class="flex" style="flex:1"><h3 style="margin:0">Most-used tools</h3><table id="usagestbl" style="flex:1"></table></div></div></section>
  <section id="tools"><div class="flex" style="margin-bottom:10px"><input id="tool-filter" placeholder="filter tools..." type="text"><button id="reload-tools">Refresh</button></div><table id="toolstbl"></table><div id="tool-detail"></div></section>
  <section id="router"><div class="flex" style="margin-bottom:10px"><input id="route-query" placeholder="try: analyze my repository architecture" type="text"><button class="primary" id="route-btn">Route</button></div><pre id="route-out"></pre></section>
  <section id="activity"><table id="activitytbl"></table></section>
  <section id="approvals"><table id="approvalstbl"></table><p class="muted" id="approvals-empty"></p></section>
  <section id="policies"><pre id="police-out"></pre></section>
  <section id="benchmark"><p class="muted">Runs the deterministic 13-task suite against the live registry. Click to refresh.</p><button id="bench-run" class="primary">Run benchmark</button><pre id="bench-out"></pre></section>
  <section id="settings"><pre id="config-out"></pre></section>
</main>
<script>
const $=s=>document.querySelector(s);
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll("section").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");$("#"+b.dataset.sec).classList.add("active");
  if(b.dataset.sec==="tools")loadTools();
  if(b.dataset.sec==="activity")loadActivity();
  if(b.dataset.sec==="approvals")loadApprovals();
  if(b.dataset.sec==="policies")loadPolicies();
  if(b.dataset.sec==="settings")loadConfig();
});
async function j(url,opts){const r=await fetch(url,opts);const d=await r.json().catch(()=>({}));return r.ok?d:Promise.reject(d);}
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function statusPill(s){s=String(s).toLowerCase();
  const cls=s==="success"?"ok":s==="error"||s==="denied"?"err":s==="timeout"?"warn":"idle";
  return '<span class="pill '+cls+'">'+esc(s)+'</span>';}
async function loadSummary(){
  const s=await j("/api/summary");
  const cards=[["Tools",s.tools],["Enabled",s.enabled],["Calls",s.calls],["Success",s.successRate+"%"],["Avg latency",s.avgLatencyMs+"ms"],["Pending approvals",s.pendingApprovals]];
  $("#sumcards").innerHTML=cards.map(c=>'<div class="card"><div class="k">'+c[0]+'</div><div class="v">'+c[1]+'</div></div>').join("");
  $("#usagestbl").innerHTML="<tr><th>Tool</th><th>Calls</th></tr>"+Object.entries(s.byTool).sort((a,b)=>b[1]-a[1]).map(([t,n])=>'<tr><td>'+esc(t)+'</td><td>'+n+'</td></tr>').join("")||"<tr><td class='muted' colspan='2'>no activity yet</td></tr>";
}
async function loadTools(){
  const tools=await j("/api/tools");
  const f=($("#tool-filter").value||"").toLowerCase();
  const rows=tools.filter(t=>!f||JSON.stringify(t).toLowerCase().includes(f));
  $("#toolstbl").innerHTML="<tr><th>Tool</th><th>Version</th><th>Transport</th><th>Capabilities</th><th>Execs</th><th>Health</th><th></th></tr>"+
   rows.map(t=>'<tr><td>'+esc(t.name)+'</td><td>'+esc(t.version)+'</td><td>'+esc(t.transport)+'</td><td class="muted">'+t.capabilities.map(esc).join(", ")+'</td><td>'+t.executions+'</td><td>'+statusPill(t.health)+'</td><td>'+
   '<button data-enable="'+esc(t.name)+'" data-current="'+(t.enabled?"1":"0")+'">'+(t.enabled?"Disable":"Enable")+'</button> <button data-detail="'+esc(t.name)+'">Detail</button></td></tr>').join("");
}
document.getElementById("toolstbl").addEventListener("click",async e=>{
  const btn=e.target.closest("button");if(!btn)return;
  if(btn.dataset.enable!==undefined){
    const enabled=btn.dataset.current!=="1";
    await j("/api/tools/"+encodeURIComponent(btn.dataset.enable)+"/enable",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({enabled})});
    loadTools();
  }
  if(btn.dataset.detail!==undefined){
    const t=await j("/api/tools/"+encodeURIComponent(btn.dataset.detail));
    $("#tool-detail").innerHTML="<h3>"+esc(t.name)+" <span class='pill "+(t.enabled?"ok":"err")+"'>"+(t.enabled?"enabled":"disabled")+"</span></h3><pre>"+esc(JSON.stringify(t,null,2))+"</pre>";
  }
});
document.getElementById("reload-tools").onclick=loadTools;
document.getElementById("tool-detail").innerHTML="";
document.getElementById("route-btn").onclick=async()=>{
  const q=$("#route-query").value;if(!q)return;
  const d=await j("/api/route?query="+encodeURIComponent(q));
  $("#route-out").textContent=JSON.stringify(d,null,2);
};
async function loadActivity(){
  const {summary,recent}=await j("/api/activity");
  $("#activitytbl").innerHTML="<tr><th>Time</th><th>Execution</th><th>Tool</th><th>Router</th><th>Conf</th><th>Status</th><th>ms</th></tr>"+
   recent.map(r=>'<tr><td class="muted">'+esc(r.timestamp.replace("T"," ").slice(0,19))+'</td><td>'+esc(r.executionId)+'</td><td>'+esc(r.tool)+'</td><td>'+esc(r.router)+'</td><td>'+(+(r.confidence*100).toFixed(0))+'%</td><td>'+statusPill(r.status)+'</td><td>'+r.durationMs+'</td></tr>').join("")||"<tr><td class='muted' colspan='7'>no executions yet</td></tr>";
}
async function loadApprovals(){
  const list=await j("/api/approvals");
  $("#approvals-empty").textContent=list.length?"":"No pending approvals.";
  $("#approvalstbl").innerHTML="<tr><th>ID</th><th>Tool</th><th>Scope</th><th>Requested</th><th></th></tr>"+
   list.map(a=>'<tr><td>'+esc(a.id)+'</td><td>'+esc(a.tool)+'</td><td class="muted">'+esc(a.scopes.join(", "))+'</td><td class="muted">'+esc(a.requestedAt)+'</td><td><button data-ap="'+esc(a.id)+'" data-v="1">Approve</button> <button data-ap="'+esc(a.id)+'" data-v="0">Deny</button></td></tr>').join("");
}
document.getElementById("approvalstbl").addEventListener("click",async e=>{
  const b=e.target.closest("button[data-ap]");if(!b)return;
  await j("/api/approvals/"+encodeURIComponent(b.dataset.ap),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approved:b.dataset.v==="1"})});
  loadApprovals();loadSummary();
});
async function loadPolicies(){$("#police-out").textContent=JSON.stringify(await j("/api/policies"),null,2);}
async function loadConfig(){$("#config-out").textContent=JSON.stringify(await j("/api/config"),null,2);}
document.getElementById("bench-run").onclick=async()=>{
  const out=$("#bench-out");out.textContent="running...";
  try{const r=await j("/api/benchmark");out.textContent=JSON.stringify({tools:r.tools,tasks:r.tasks,accuracy:r.accuracy+"%",success:r.success,failures:r.results.filter(x=>!x.correct)},null,2);}catch(e){out.textContent="benchmark failed: "+e.message;}
};
$("#route-query").addEventListener("keydown",e=>{if(e.key==="Enter")$("#route-btn").click()});
$("#tool-filter").addEventListener("input",loadTools);
loadSummary();loadTools();loadConfig();
</script>
</body>
</html>`;