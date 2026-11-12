/**
 * Datoriile pe vechime (cod partajat server / browser): plătitorii cu datorie, grupați după de cât timp sunt datornici.
 * Vechimea = lunile scurse de la prima factură rămasă neachitată din lanțul de facturi (cea mai veche cu statusul Trimisă / Restantă) până în luna curentă, cel puțin 1.
 */

export const AGING_BUCKETS = [
  { key: "m1_3", label: "1–3 luni", min: 1, max: 3 },
  { key: "m3_12", label: "3 luni – 1 an", min: 4, max: 12 },
  { key: "y1_3", label: "1 – 3 ani", min: 13, max: 36 },
  { key: "y3p", label: "Peste 3 ani", min: 37, max: Infinity },
] as const;

export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

/** Valorile filtrului „Datorie pe vechime” din Plătitori / Notificări. */
export const AGING_FILTER_VALUES = AGING_BUCKETS.map((b) => b.key) as unknown as readonly AgingKey[];

export const bucketOf = (months: number): AgingKey => AGING_BUCKETS.find((b) => months >= b.min && months <= b.max)?.key ?? "y3p";

export type AgingRow = {
  id: string;
  name: string;
  /** cont personal / nr. contract */
  account: string | null;
  address: string | null;
  phone: string | null;
  /** datoria reportată pe ultima factură (MDL) */
  debt: number;
  /** de achitat total pe ultima factură (MDL) */
  total: number;
  /** luna celei mai vechi facturi neachitate, „YYYY-MM” */
  since: string;
  /** luni de datorie (≥ 1) */
  months: number;
  bucket: AgingKey;
  /** vechimea e estimată: n-a fost găsită o factură neachitată (datoria vine din 1C), se folosește scadența ultimei facturi */
  approx?: boolean;
};

export type AgingReport = {
  builtAt: number;
  rows: AgingRow[];
  /** pe intervale: câți plătitori și ce sumă */
  buckets: { key: AgingKey; count: number; sum: number }[];
};
