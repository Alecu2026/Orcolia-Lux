"use client";

export default function PrintButton({ token, origin }: { token: string; origin: string }) {
  async function copy() {
    const url = `${origin}/invoice/public/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiat!");
    } catch {
      prompt("Copiază linkul:", url);
    }
  }
  return (
    <div className="flex gap-2 print:hidden">
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700"
      >
        Descarcă PDF
      </button>
      <button
        onClick={copy}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        Copiază link
      </button>
    </div>
  );
}
