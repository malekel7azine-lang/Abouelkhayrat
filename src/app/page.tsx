import { ensureSchema } from "@/lib/db";
import AdminPanel from "./admin-panel";

export const dynamic = "force-dynamic";

async function getHealth() {
  try { await ensureSchema(); return "متصل"; }
  catch { return "غير متاح"; }
}

export default async function Dashboard() {
  const health = await getHealth();
  return <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-5 md:p-10">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="muted text-sm">لوحة الإدارة</p><h1 className="mt-2 text-3xl font-bold">MCP Media Generator</h1><p className="muted mt-2">إدارة توليد الصور والفيديو والمفاتيح والمهام</p></div>
      <span className="rounded-full border border-cyan-800 bg-cyan-950 px-4 py-2 text-sm text-cyan-200">الإصدار 1.1</span>
    </header>
    <section className="grid gap-4 md:grid-cols-3">
      <article className="panel"><p className="muted text-sm">قاعدة البيانات</p><h2 className="mt-3 text-2xl font-semibold">{health}</h2></article>
      <article className="panel"><p className="muted text-sm">خادم MCP</p><h2 className="mt-3 text-2xl font-semibold">/mcp</h2><p className="muted mt-2 text-sm">Streamable HTTP</p></article>
      <article className="panel"><p className="muted text-sm">المزودون</p><h2 className="mt-3 text-2xl font-semibold">Kie.ai · CometAPI</h2><p className="muted mt-2 text-sm">تدوير المفاتيح والتحويل الاحتياطي</p></article>
    </section>
    <AdminPanel />
  </main>;
}
