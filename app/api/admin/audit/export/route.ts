import { requireSuperAdmin } from "@/lib/dal";
import { exportAuditLogs } from "@/lib/queries/audit";
import { actionLabel, moduleLabel } from "@/lib/audit-meta";

function toDate(s: string | null, end = false): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
}

function fmtDate(d: Date): string {
  const p = new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}

function csvEscape(v: string): string {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
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
  "Valoare veche",
  "Valoare nouă",
  "IP",
];

export async function GET(req: Request) {
  await requireSuperAdmin();

  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") ?? "csv";
  const today = new Date().toISOString().slice(0, 10);

  const rows = await exportAuditLogs({
    userId: sp.get("user") || undefined,
    role: sp.get("role") || undefined,
    action: sp.get("action") || undefined,
    module: sp.get("module") || undefined,
    from: toDate(sp.get("from")),
    to: toDate(sp.get("to"), true),
    search: sp.get("q") || undefined,
  });

  const data = rows.map((r) => [
    fmtDate(r.createdAt),
    r.userName,
    r.userRole,
    moduleLabel(r.module),
    actionLabel(r.action),
    r.objectName ?? "",
    r.oldValue ?? "",
    r.newValue ?? "",
    r.ip ?? "",
  ]);

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
  const BOM = "﻿";
  const csvRows = [HEADERS, ...data].map((row) => row.map(csvEscape).join(","));
  return new Response(BOM + csvRows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-logs-${today}.csv"`,
    },
  });
}
