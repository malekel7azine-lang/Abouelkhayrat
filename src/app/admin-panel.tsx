"use client";

import { useCallback, useState } from "react";

type KeyRow = { id: string; provider: "kie" | "cometapi"; label: string; status: string; masked: string };
type TaskRow = { id: string; type: string; status: string; provider: string | null; model: string | null; created_at: string };
type ConfigState = { kieConfigured: boolean; cometapiConfigured: boolean; mergerConfigured: boolean };

export default function AdminPanel() {
  const [token, setToken] = useState("");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [provider, setProvider] = useState<"kie" | "cometapi">("kie");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const headers = { "x-admin-token": token, "Content-Type": "application/json" };
  const refresh = useCallback(async () => {
    if (!token) { setMessage("أدخل رمز الإدارة أولاً."); return; }
    setBusy(true);
    try {
      const [keyResponse, taskResponse] = await Promise.all([
        fetch("/api/admin/keys", { headers, cache: "no-store" }),
        fetch("/api/tasks?limit=20", { headers, cache: "no-store" })
      ]);
      if (keyResponse.status === 401 || taskResponse.status === 401) throw new Error("رمز الإدارة غير صحيح.");
      if (!keyResponse.ok || !taskResponse.ok) throw new Error("تعذر تحميل بيانات لوحة الإدارة.");
      const keyData = await keyResponse.json();
      const taskData = await taskResponse.json();
      setKeys(keyData.keys || []);
      setTasks(taskData.tasks || []);
      setMessage("تم تحديث البيانات.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "حدث خطأ."); }
    finally { setBusy(false); }
  }, [token]);

  async function addKey(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/admin/keys", { method: "POST", headers, body: JSON.stringify({ provider, label: label || provider, secret }) });
      if (!response.ok) throw new Error("تعذر إضافة المفتاح. تحقق من رمز الإدارة والبيانات.");
      setSecret(""); setLabel(""); setMessage("تمت إضافة المفتاح.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "حدث خطأ."); }
    finally { setBusy(false); }
  }

  async function updateKey(id: string, action: "active" | "disabled" | "delete") {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/keys/" + encodeURIComponent(id), {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers,
        ...(action === "delete" ? {} : { body: JSON.stringify({ status: action }) })
      });
      if (!response.ok) throw new Error("تعذر تحديث المفتاح.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "حدث خطأ."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <section className="panel space-y-4">
      <div><h2 className="text-xl font-semibold">إدارة المفاتيح ومهام الإنتاج</h2><p className="muted mt-1 text-sm">رمز الإدارة هو ADMIN_API_TOKEN، أو MCP_AUTH_TOKEN إذا لم يتم ضبط رمز إدارة مستقل. لا تشارك هذا الرمز.</p></div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field min-w-0 flex-1" type="password" autoComplete="off" placeholder="رمز الإدارة" value={token} onChange={e => setToken(e.target.value)} />
        <button className="action" onClick={refresh} disabled={busy}>تحديث البيانات</button>
      </div>
      {message && <p className="text-sm text-cyan-200">{message}</p>}
    </section>

    <section className="panel space-y-4">
      <div><h2 className="text-xl font-semibold">إضافة مفتاح مزود</h2><p className="muted mt-1 text-sm">المفتاح يُرسل إلى الخادم فقط، ولا يُعاد عرضه بعد الحفظ.</p></div>
      <form onSubmit={addKey} className="grid gap-3 md:grid-cols-2">
        <select className="field" value={provider} onChange={e => setProvider(e.target.value as "kie" | "cometapi")}><option value="kie">Kie.ai</option><option value="cometapi">CometAPI</option></select>
        <input className="field" placeholder="اسم وصفي (اختياري)" value={label} onChange={e => setLabel(e.target.value)} />
        <input className="field md:col-span-2" type="password" autoComplete="new-password" placeholder="API key" value={secret} onChange={e => setSecret(e.target.value)} required />
        <button className="action md:col-span-2" disabled={busy || !token || !secret}>حفظ المفتاح</button>
      </form>
    </section>

    <section className="panel space-y-3">
      <h2 className="text-xl font-semibold">مفاتيح API</h2>
      {keys.length === 0 ? <p className="muted text-sm">لا توجد مفاتيح محفوظة في قاعدة البيانات. قد تكون مفاتيح البيئة مستخدمة عند توفرها.</p> :
        <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead><tr className="muted border-b border-slate-700"><th className="p-2">المزود</th><th className="p-2">الاسم</th><th className="p-2">الحالة</th><th className="p-2">إجراء</th></tr></thead><tbody>
          {keys.map(key => <tr key={key.id} className="border-b border-slate-800"><td className="p-2">{key.provider}</td><td className="p-2">{key.label}<div className="muted text-xs">{key.masked}</div></td><td className="p-2">{key.status}</td><td className="flex flex-wrap gap-2 p-2"><button className="subaction" onClick={() => updateKey(key.id, key.status === "active" ? "disabled" : "active")}>{key.status === "active" ? "تعطيل" : "إعادة تفعيل"}</button>{!key.id.startsWith("env-") && <button className="subaction danger" onClick={() => updateKey(key.id, "delete")}>حذف</button>}</td></tr>)}
        </tbody></table></div>}
    </section>

    <section className="panel space-y-3">
      <h2 className="text-xl font-semibold">آخر المهام</h2>
      {tasks.length === 0 ? <p className="muted text-sm">لا توجد مهام حتى الآن.</p> :
        <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead><tr className="muted border-b border-slate-700"><th className="p-2">Task ID</th><th className="p-2">النوع</th><th className="p-2">الحالة</th><th className="p-2">المزود</th></tr></thead><tbody>
          {tasks.map(task => <tr key={task.id} className="border-b border-slate-800"><td className="p-2 font-mono text-xs">{task.id.slice(0, 12)}…</td><td className="p-2">{task.type}</td><td className="p-2">{task.status}</td><td className="p-2">{task.provider || "—"}</td></tr>)}
        </tbody></table></div>}
    </section>
  </div>;
}
