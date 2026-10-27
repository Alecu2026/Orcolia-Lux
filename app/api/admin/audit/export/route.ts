import { requireSuperAdmin } from "@/lib/dal";
import { exportAuditLogs, filterFromState } from "@/lib/queries/audit";
import { actionLabel, describeAgent, moduleLabel, parseDetails, sanitizeAuditState } from "@/lib/audit-meta";

function fmtDate(d: Date): string {
  const p = new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function csvEscape(v: string): string {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return `"${s}"`;
}

function htmlEscape(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const HEADERS = [
  "Data & ora",
  "Utilizator",
  "Rol",
  "Modul",
  "Acțiune",
  "Obiect",
  "ID obiect",
  "Valoare veche",
  "Valoare nouă",
  "Modificări (câmp: vechi → nou)",
  "Pagina",
  "IP",
  "Dispozitiv",
];

export async function GET(req: Request) {
  await requireSuperAdmin();

  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") ?? "csv";
  const today = new Date().toISOString().slice(0, 10);

  const rows = await exportAuditLogs(filterFromState(sanitizeAuditState(Object.fromEntries(sp.entries()))));

  const data = rows.map((r) => {
    const d = parseDetails(r.details);
    const ua = describeAgent(r.userAgent);
    return [
      fmtDate(r.createdAt),
      r.userName,
      r.userRole,
      moduleLabel(r.module),
      actionLabel(r.action),
      r.objectName ?? "",
      r.objectId ?? "",
      r.oldValue ?? "",
      r.newValue ?? "",
      (d?.changes ?? []).map((c) => `${c.label}: ${c.old ?? "—"} → ${c.new ?? "—"}`).join(" | "),
      r.path ?? "",
      r.ip ?? "",
      ua ? `${ua.browser} · ${ua.os} · ${ua.device}` : "",
    ];
  });

  if (format === "excel") {
    const thRow = HEADERS.map((h) => `<th>${htmlEscape(h)}</th>`).join("");
    const tdRows = data
      .map((row) => `<tr>${row.map((c) => `<td>${htmlEscape(c)}</td>`).join("")}</tr>`)
      .join("");
    const html = `<html><head><meta charset="UTF-8"/></head><body><table><tr>${thRow}</tr>${tdRows}</table></body></html>`;
    return new Response(html, {
      headers: {
        "Content-Type": "application/vnd.ms-excel",
        "Content-Disposition": `attachment; filename="audit-logs-${today}.xls"`,
      },
    });
  }

  // CSV cu BOM UTF-8 pentru compatibilitate Excel
  const BOM = "\uFEFF";
  const csvRows = [HEADERS, ...data].map((row) => row.map(csvEscape).join(","));
  return new Response(BOM + csvRows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-logs-${today}.csv"`,
    },
  });
}
