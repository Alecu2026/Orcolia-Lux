import * as XLSX from "xlsx";

type Row = Record<string, string | number | boolean | null | undefined>;

export function toCSV(headers: string[], rows: Row[]): string {
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\r\n");
}

/** O foaie în plus (după cea cu date): rânduri libere, prima coloană text, restul numere. */
export type ExtraSheet = { name: string; rows: (string | number)[][] };

export function toXLSX(headers: string[], rows: Row[], extraSheets: ExtraSheet[] = []): Blob {
  const sheetData = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Auto-width columns
  const colWidths = headers.map((h) => {
    const maxLen = Math.max(
      h.length,
      ...rows.map((r) => String(r[h] ?? "").length),
    );
    return { wch: Math.min(maxLen + 2, 60) };
  });
  ws["!cols"] = colWidths;
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: Math.max(headers.length - 1, 0) } }) };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Export");
  for (const s of extraSheets) {
    const es = XLSX.utils.aoa_to_sheet(s.rows);
    es["!cols"] = [{ wch: Math.min(Math.max(...s.rows.map((r) => String(r[0] ?? "").length), 10) + 2, 60) }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, es, s.name);
  }
  const arr = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as unknown as ArrayBuffer;
  return new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/**
 * Corpul se trimite în flux (stream), nu ca un bloc: funcțiile Vercel refuză răspunsurile "normale"
 * peste 4,5 MB (export cu ~19.000 de plătitori depășește ușor), dar nu și pe cele transmise în flux.
 */
export function streamText(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream() as ReadableStream<Uint8Array>;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(streamText(csv), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function xlsxResponse(blob: Blob, filename: string): Response {
  return new Response(blob.stream() as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
