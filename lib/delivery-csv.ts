import "server-only";
import { CHANNEL_LABEL, STATUS_LABEL, kindLabel, sourceLabel, stripTags } from "./delivery-meta";
import type { DeliveryFullRow } from "./queries/delivery";

function fmtDate(d: Date): string {
  const p = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
const csvEscape = (v: string) => (/["\n\r,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : `"${v}"`);
const HEADERS = ["Data & ora", "Canal", "Status", "Tip", "Sursă", "Destinatar", "Adresă", "De la (utilizator)", "Expeditor (From)", "Subiect", "Mesaj", "Obiect", "ID campanie", "Eroare", "ID furnizor", "Durată (ms)"];

/** Mesajele filtrate → fișier CSV (Excel-friendly, cu BOM). Folosit de jurnalul complet (super-admin) și de cel al plătitorilor. */
export function deliveryCsvResponse(rows: DeliveryFullRow[]): Response {
  const data = rows.map((r) => [
    fmtDate(r.createdAt), CHANNEL_LABEL[r.channel] ?? r.channel, STATUS_LABEL[r.status] ?? r.status, kindLabel(r.kind), sourceLabel(r.source),
    r.toName ?? "", r.to ?? "", r.fromName ?? "", r.fromAddr ?? "", r.subject ?? "", stripTags(r.body).replace(/\s+/g, " ").trim().slice(0, 2000),
    [r.objectType, r.objectName].filter(Boolean).join(": "), r.campaignId ?? "", r.error ?? "", r.providerId ?? "", r.durationMs == null ? "" : String(r.durationMs),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const csv = "﻿" + [HEADERS, ...data].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="jurnal-notificari-${today}.csv"` } });
}
