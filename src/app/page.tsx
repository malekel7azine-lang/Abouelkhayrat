import { ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getHealth() {
  try {
    await ensureSchema();
    return "متصل";
  } catch { return "غير متاح"; }
}

export default async function Dashboard() {
  const health = await getHealth();
  return <main className="mx-auto min-h-screen max-w-6xl p-6 md:p-10">
    <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
      <div><p className="muted text-sm">لوحة التحكم</p><h1 className="mt-2 text-3xl font-bold">MCP Media Generator</h1>
      <p className="muted mt-2">إدارة توليد الصور والفيديو والمهام ومزودي الخدمة</p></div>
      <span className="rounded-full border border-cyan-800 bg-cyan-950 px-4 py-2 text-sm text-cyan-200">الإصدار 1.0</span>
    </header>
    <section className="grid gap-4 md:grid-cols-3">
      <article className="panel"><p className="muted text-sm">حالة قاعدة البيانات</p><h2 className="mt-3 text-2xl font-semibold">{health}</h2></article>
      <article className="panel"><p className="muted text-sm">خادم MCP</p><h2 className="mt-3 text-2xl font-semibold">/mcp</h2><p className="muted mt-2 text-sm">Streamable HTTP</p></article>
      <article className="panel"><p className="muted text-sm">مزودو التوليد</p><h2 className="mt-3 text-2xl font-semibold">Kie.ai · CometAPI</h2><p className="muted mt-2 text-sm">تُفعّل بعد إضافة المفاتيح السرية</p></article>
    </section>
    <section className="panel mt-6">
      <h2 className="text-xl font-semibold">حالة التنفيذ</h2>
      <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-7">
        <li>تم إنشاء هيكل Next.js وTypeScript.</li>
        <li>تم إعداد عميل Turso ومخطط المهام ومفاتيح المزودين.</li>
        <li>نقطة MCP الأولية متاحة؛ عمليات التوليد والدمج قيد التنفيذ.</li>
        <li>لم تُضف أي مفاتيح API حقيقية إلى المستودع.</li>
      </ul>
    </section>
  </main>;
}