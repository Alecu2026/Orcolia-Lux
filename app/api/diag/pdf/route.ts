import { getCurrentUser, isSuper } from "@/lib/dal";
import { isCronAuthorized } from "@/lib/cron-auth";
import { PdfBrowserError, launchBrowser } from "@/lib/pdf-browser";
import { selfBaseUrl } from "@/lib/self-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Diagnostic pentru descărcarea PDF-urilor (decontare, factură) — doar super-admin (sau CRON_SECRET). Pornește Chromium, face un PDF de probă și spune ce
 * nu merge: Chromium lipsă pe server (cu comanda de instalare), adresa prin care serverul se apelează pe el însuși (INTERNAL_APP_URL) sau altceva.
 * Deschide `/api/diag/pdf` în browser, conectat ca super-admin.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isSuper(user) && !isCronAuthorized(req)) return Response.json({ error: "Doar super-admin." }, { status: 403 });

  const info = { platform: process.platform, node: process.version, chromePath: process.env.CHROME_PATH || null, vercel: !!process.env.VERCEL };
  const t0 = Date.now();
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser();
    const launchedMs = Date.now() - t0;
    const page = await browser.newPage();
    await page.setContent("<p style='font-family:sans-serif'>Probă PDF — ăâîșț / Проба</p>");
    const pdf = await page.pdf({ format: "A4" });
    const base = await selfBaseUrl(req.url);
    return Response.json({ ok: true, ...info, launchedMs, totalMs: Date.now() - t0, pdfBytes: pdf.length, selfUrl: base, note: "Chromium pornește și poate face PDF. Dacă descărcarea tot eșuează, verifică selfUrl (setează INTERNAL_APP_URL=http://127.0.0.1:PORT)." });
  } catch (e) {
    if (e instanceof PdfBrowserError) return Response.json({ ok: false, ...info, error: e.message, attempts: e.attempts, hint: e.hint }, { status: 500 });
    return Response.json({ ok: false, ...info, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
    await browser?.cleanup().catch(() => {});
  }
}
