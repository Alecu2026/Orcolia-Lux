import type { PermissionKey } from "../permissions";

/**
 * Conținutul „Manualului de utilizare pentru administrator” (partajat server + browser). Textele sunt scrise direct în română, simplu, pe pagini (vezi content-*.ts);
 * pozele NU sunt în cod: fiecare loc pentru poză („shot”) are o cheie unică, iar poza încărcată se păstrează în baza de date (model ManualShot) și pe discul serverului.
 */

/** Un loc pentru screenshot. Cât timp nu e încărcată poza, se arată `where` (de unde faci poza); după încărcare textul dispare și rămâne doar poza cu `caption`. */
export type Shot = {
  /** cheie unică (ex. „sarcini-1”) — nu se schimbă niciodată după ce s-a încărcat o poză */
  key: string;
  /** de unde faci screenshot-ul: calea prin meniu și ce anume cuprinzi în poză */
  where: string;
  /** ce se vede în poză (apare sub poză, după încărcare) */
  caption: string;
};

/**
 * Cine vede o pagină / un bloc din manual: lipsă = oricine are dreptul „Manual de utilizare” (secțiunile generale). O cheie de drept (sau o listă = oricare dintre ele), sau:
 * "super" = doar super-administratorii; "editor" = doar contul care pune pozele. Contul „editor” vede TOT (ca să poată pune poze peste tot).
 */
export type PermReq = PermissionKey | "super" | "editor" | PermissionKey[];

type Gate = { perm?: PermReq };
export type Block = Gate &
  (
    | { t: "p"; text: string }
    | { t: "steps"; title?: string; items: string[] }
    | { t: "list"; title?: string; items: string[] }
    | { t: "tip"; text: string }
    | { t: "warn"; text: string }
    | { t: "shot"; shot: Shot }
  );

export type ManualPage = {
  id: string;
  title: string;
  /** adresa paginii din aplicație (apare ca buton „Deschide pagina”) */
  path?: string;
  /** cine vede pagina în meniu (o frază scurtă), dacă nu o văd toți */
  who?: string;
  /** dreptul cerut ca pagina să apară în manualul unui utilizator (lipsă = pagină generală, o văd toți cei cu „Manual de utilizare”) */
  perm?: PermReq;
  blocks: Block[];
};

export type ManualSection = {
  id: string;
  title: string;
  /** numele iconiței (vezi app/components/ManualIcons.tsx): rocket, bell, list, users, droplet, phone, tools, sliders, globe, help */
  icon: string;
  intro?: string;
  pages: ManualPage[];
};

/** Marchează blocurile din `blocks` ca vizibile doar cu dreptul `perm` (ex. partea de trimitere dintr-o pagină pe care o văd și cei care doar răsfoiesc). */
export const gated = (perm: PermReq, ...blocks: Block[]): Block[] => blocks.map((b) => ({ ...b, perm }) as Block);

// ── scurtături pentru scrierea conținutului ─────────────────────────────────
export const p = (text: string): Block => ({ t: "p", text });
export const steps = (items: string[], title?: string): Block => ({ t: "steps", title, items });
export const list = (items: string[], title?: string): Block => ({ t: "list", title, items });
export const tip = (text: string): Block => ({ t: "tip", text });
export const warn = (text: string): Block => ({ t: "warn", text });
export const shot = (key: string, where: string, caption: string): Block => ({ t: "shot", shot: { key, where, caption } });
