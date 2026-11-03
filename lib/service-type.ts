/** Tipul serviciului la care se referă o cerere/petiție: apă, canalizare sau amândouă. Gol = nespecificat (cererile mai vechi). */
export const SERVICE_TYPES = ["WATER", "SEWER", "BOTH"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  WATER: "Apă",
  SEWER: "Canalizare",
  BOTH: "Apă + canalizare",
};

/** Valoare primită din formular/client → tip valid sau null (orice altceva se ignoră). */
export function parseServiceType(v: unknown): ServiceType | null {
  return typeof v === "string" && (SERVICE_TYPES as readonly string[]).includes(v) ? (v as ServiceType) : null;
}

/** Eticheta (în română, de tradus cu t()) a unei valori salvate; gol pentru nespecificat. */
export function serviceTypeLabel(v: unknown): string {
  const k = parseServiceType(v);
  return k ? SERVICE_TYPE_LABEL[k] : "";
}
