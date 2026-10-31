// Mesajele AUTOMATE către clienți pentru termenele de remediere ale neregulilor de contor: șabloane pe tip de neregulă și pe etapă (înainte de termen / termen depășit), cu SMS, subiect
// și text de email. Se pot vedea și modifica din „Nereguli contoare” (cod partajat server / browser). Ce nu e modificat rămâne la textul implicit de mai jos.

import { ISSUE_KINDS, ISSUE_LABELS, ISSUE_LABELS_RU, type IssueKind } from "./meter-issues";

export const MSG_KEYS = [...ISSUE_KINDS, "MULTI"] as const;
export type MsgKey = (typeof MSG_KEYS)[number];
export const MSG_STAGES = ["before", "overdue"] as const;
export type MsgStage = (typeof MSG_STAGES)[number];

export type IssueMessage = { sms: string; subject: string; email: string };
export type IssueMessages = Record<MsgKey, Record<MsgStage, IssueMessage>>;

export const MSG_LIMITS = { sms: 480, subject: 200, email: 4000 } as const;

/** Tokenurile disponibile (cheile de traducere pentru etichete); {nr}, {lista}, {lista_ru} există doar în mesajul „mai multe nereguli”. */
export const MSG_TOKENS: { key: string; label: string; multiOnly?: boolean; singleOnly?: boolean }[] = [
  { key: "nume", label: "Numele clientului" },
  { key: "companie", label: "Numele companiei" },
  { key: "contor", label: "Nr. contor", singleOnly: true },
  { key: "tip", label: "Tipul neregulii (română)", singleOnly: true },
  { key: "tip_ru", label: "Tipul neregulii (rusă)", singleOnly: true },
  { key: "termen", label: "Termenul de remediere", singleOnly: true },
  { key: "zile", label: "Cât mai e / cât a trecut (română)", singleOnly: true },
  { key: "zile_ru", label: "Cât mai e / cât a trecut (rusă)", singleOnly: true },
  { key: "nr", label: "Numărul de nereguli", multiOnly: true },
  { key: "lista", label: "Lista neregulilor (română)", multiOnly: true },
  { key: "lista_ru", label: "Lista neregulilor (rusă)", multiOnly: true },
];

/** Ce să facă clientul, pe tip (ține de client: sigiliu, fraudă, acces, citire); la restul textul rămâne general. */
const HINT_RO: Partial<Record<IssueKind, string>> = {
  SEAL: "Vă rugăm să nu interveniți asupra contorului și să ne contactați pentru resigilare.",
  FRAUD: "Vă rugăm să restabiliți starea inițială a instalației și să ne contactați.",
  INACCESSIBLE: "Vă rugăm să asigurați accesul la contor sau să ne spuneți când putem veni.",
  UNREADABLE: "Vă rugăm să curățați sau să protejați contorul astfel încât indexul să poată fi citit.",
};
const HINT_RU: Partial<Record<IssueKind, string>> = {
  SEAL: "Просим не вмешиваться в работу счётчика и связаться с нами для опломбирования.",
  FRAUD: "Просим восстановить первоначальное состояние установки и связаться с нами.",
  INACCESSIBLE: "Просим обеспечить доступ к счётчику или сообщить, когда мы можем приехать.",
  UNREADABLE: "Просим очистить или защитить счётчик так, чтобы показания можно было прочитать.",
};

function defaultFor(key: MsgKey, stage: MsgStage): IssueMessage {
  const overdue = stage === "overdue";
  if (key === "MULTI") {
    return {
      subject: overdue ? "Termenul de remediere a expirat / Срок устранения истёк" : "Termenul de remediere se apropie / Срок устранения приближается",
      sms: overdue ? "{companie}: a expirat termenul de remediere pentru {nr} nereguli la contoarele dvs. Contactati-ne." : "{companie}: se apropie termenul de remediere pentru {nr} nereguli la contoarele dvs. Contactati-ne.",
      email:
        `Stimate(ă) {nume},\n\n${overdue ? "Termenul de remediere a expirat pentru următoarele nereguli constatate la contoarele dumneavoastră" : "Se apropie termenul de remediere pentru următoarele nereguli constatate la contoarele dumneavoastră"}:\n{lista}\n\n` +
        `Vă rugăm să remediați situația sau să ne contactați cât mai curând.\n\nCu respect,\n{companie}\n\n— — —\n\n` +
        `Уважаемый(ая) {nume},\n\n${overdue ? "Истёк срок устранения следующих нарушений, выявленных на ваших счётчиках" : "Приближается срок устранения следующих нарушений, выявленных на ваших счётчиках"}:\n{lista_ru}\n\n` +
        `Пожалуйста, устраните нарушение или свяжитесь с нами как можно скорее.\n\nС уважением,\n{companie}`,
    };
  }
  const hintRo = HINT_RO[key] ? `${HINT_RO[key]}\n` : "";
  const hintRu = HINT_RU[key] ? `${HINT_RU[key]}\n` : "";
  return {
    subject: overdue ? "Termenul de remediere a expirat / Срок устранения истёк" : "Termenul de remediere se apropie ({zile}) / Срок устранения приближается ({zile_ru})",
    sms: overdue ? "{companie}: a expirat termenul de remediere la contorul {contor} ({tip}): {termen}. Contactati-ne." : "{companie}: termenul de remediere la contorul {contor} ({tip}): {termen}. Contactati-ne.",
    email:
      `Stimate(ă) {nume},\n\n${overdue ? "Termenul de remediere a expirat pentru" : "Se apropie termenul de remediere pentru"} neregula constatată la contorul dumneavoastră nr. {contor}: {tip} (termen: {termen}, {zile}).\n\n` +
      `${hintRo}Vă rugăm să remediați situația sau să ne contactați cât mai curând.\n\nCu respect,\n{companie}\n\n— — —\n\n` +
      `Уважаемый(ая) {nume},\n\n${overdue ? "Истёк срок устранения" : "Приближается срок устранения"} нарушения, выявленного на вашем счётчике № {contor}: {tip_ru} (срок: {termen}, {zile_ru}).\n\n` +
      `${hintRu}Пожалуйста, устраните нарушение или свяжитесь с нами как можно скорее.\n\nС уважением,\n{companie}`,
  };
}

export const DEFAULT_ISSUE_MESSAGES: IssueMessages = Object.fromEntries(
  MSG_KEYS.map((k) => [k, { before: defaultFor(k, "before"), overdue: defaultFor(k, "overdue") }]),
) as IssueMessages;

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.replace(/\r\n/g, "\n").slice(0, max) : null);

/** Suprascrierile salvate (JSON) peste valorile implicite: ce lipsește sau e gol revine la textul implicit. */
export function resolveIssueMessages(raw: unknown): IssueMessages {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as IssueMessages;
  for (const k of MSG_KEYS) {
    const byStage = src[k] && typeof src[k] === "object" ? (src[k] as Record<string, unknown>) : {};
    out[k] = {} as Record<MsgStage, IssueMessage>;
    for (const st of MSG_STAGES) {
      const d = DEFAULT_ISSUE_MESSAGES[k][st];
      const m = byStage[st] && typeof byStage[st] === "object" ? (byStage[st] as Record<string, unknown>) : {};
      out[k][st] = { sms: str(m.sms, MSG_LIMITS.sms) ?? d.sms, subject: str(m.subject, MSG_LIMITS.subject) ?? d.subject, email: str(m.email, MSG_LIMITS.email) ?? d.email };
    }
  }
  return out;
}

/** Doar ce diferă de textul implicit (ce se salvează în setări). */
export function diffFromDefaults(msgs: IssueMessages): Record<string, Record<string, Partial<IssueMessage>>> {
  const out: Record<string, Record<string, Partial<IssueMessage>>> = {};
  for (const k of MSG_KEYS) for (const st of MSG_STAGES) {
    const d = DEFAULT_ISSUE_MESSAGES[k][st];
    const m = msgs[k][st];
    const part: Partial<IssueMessage> = {};
    if (m.sms !== d.sms) part.sms = m.sms;
    if (m.subject !== d.subject) part.subject = m.subject;
    if (m.email !== d.email) part.email = m.email;
    if (Object.keys(part).length) (out[k] ??= {})[st] = part;
  }
  return out;
}

/** Înlocuiește {nume}, {contor}… — un token necunoscut rămâne neatins (se vede imediat în previzualizare). */
export function renderIssueTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? vars[k] : whole));
}

const fmt = (key: string) => key.split("-").reverse().join(".");
export const whenRo = (d: number) => (d < 0 ? `depășit cu ${-d} ${-d === 1 ? "zi" : "zile"}` : d === 0 ? "astăzi" : d === 1 ? "mâine" : `peste ${d} zile`);
export const whenRu = (d: number) => (d < 0 ? `просрочено на ${-d} дн.` : d === 0 ? "сегодня" : d === 1 ? "завтра" : `через ${d} дн.`);

export type IssueMsgItem = { contor: string; kind: IssueKind; key: string; days: number };

/** Valorile tokenurilor pentru un mesaj: o singură neregulă (șablonul tipului) sau mai multe (șablonul „MULTI”). */
export function issueMessageVars(name: string, company: string, items: IssueMsgItem[]): { key: MsgKey; vars: Record<string, string> } {
  const co = company || "Apă-Canal";
  if (items.length === 1) {
    const i = items[0];
    return { key: i.kind, vars: { nume: name, companie: co, contor: i.contor, tip: ISSUE_LABELS[i.kind], tip_ru: ISSUE_LABELS_RU[i.kind], termen: fmt(i.key), zile: whenRo(i.days), zile_ru: whenRu(i.days) } };
  }
  const lista = items.map((i) => `• contor nr. ${i.contor} — ${ISSUE_LABELS[i.kind]} (termen: ${fmt(i.key)}, ${whenRo(i.days)})`).join("\n");
  const listaRu = items.map((i) => `• счётчик № ${i.contor} — ${ISSUE_LABELS_RU[i.kind]} (срок: ${fmt(i.key)}, ${whenRu(i.days)})`).join("\n");
  return { key: "MULTI", vars: { nume: name, companie: co, nr: String(items.length), lista, lista_ru: listaRu } };
}

/** Exemplu pentru previzualizare în editor (înainte de termen: peste 3 zile; depășit: cu 2 zile). */
export function sampleVars(key: MsgKey, stage: MsgStage): Record<string, string> {
  const days = stage === "before" ? 3 : -2;
  const due = (() => { const d = new Date(Date.now() + days * 86_400_000); return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`; })();
  if (key === "MULTI") {
    const a = { contor: "123456", kind: "SEAL" as IssueKind, key: due.split(".").reverse().join("-"), days };
    const b = { contor: "654321", kind: "UNREADABLE" as IssueKind, key: a.key, days };
    return issueMessageVars("Ion Popescu", "Apă-Canal Cahul", [a, b]).vars;
  }
  return issueMessageVars("Ion Popescu", "Apă-Canal Cahul", [{ contor: "123456", kind: key, key: due.split(".").reverse().join("-"), days }]).vars;
}

/** Câte segmente SMS ocupă textul (fără diacritice: 160 de caractere într-un singur mesaj, apoi câte 153). */
export const smsSegments = (len: number): number => (len <= 160 ? (len === 0 ? 0 : 1) : Math.ceil(len / 153));
