/** Categoria consumatorului la care se referă o cerere / sarcină: casnic (persoană fizică) sau non casnic (agent economic, instituție). Gol = nespecificat. */
export const CONSUMER_TYPES = ["HOUSEHOLD", "NON_HOUSEHOLD"] as const;
export type ConsumerType = (typeof CONSUMER_TYPES)[number];

export const CONSUMER_TYPE_LABEL: Record<ConsumerType, string> = {
  HOUSEHOLD: "Casnic",
  NON_HOUSEHOLD: "Non casnic",
};

/** Valoare primită din formular/client → categorie validă sau null (orice altceva se ignoră). */
export function parseConsumerType(v: unknown): ConsumerType | null {
  return typeof v === "string" && (CONSUMER_TYPES as readonly string[]).includes(v) ? (v as ConsumerType) : null;
}

/** Eticheta (în română, de tradus cu t()) a unei valori salvate; gol pentru nespecificat. */
export function consumerTypeLabel(v: unknown): string {
  const k = parseConsumerType(v);
  return k ? CONSUMER_TYPE_LABEL[k] : "";
}
