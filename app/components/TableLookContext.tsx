"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TableLookPreset } from "@/lib/table-look";

/**
 * Aspectul tabelelor pentru utilizatorul curent, livrat o dată cu pagina (din utilizatorul deja citit pe server — fără cerere în plus):
 *  - `preset`: ce a setat administratorul pentru el (densitate, mărime text, lățime, culori);
 *  - `canCustomize`: are „Personalizare tabele”? Dacă da, își poate schimba singur lățimile, culorile, textul, celulele și coloanele (salvate în localStorage, peste preset).
 *    Dacă nu, vede exact presetul administratorului și controalele de personalizare nu apar.
 */
type Ctx = { preset: TableLookPreset; canCustomize: boolean };
const Ctx = createContext<Ctx>({ preset: {}, canCustomize: true });

export function TableLookProvider({ preset, canCustomize, children }: Ctx & { children: ReactNode }) {
  return <Ctx.Provider value={{ preset, canCustomize }}>{children}</Ctx.Provider>;
}

export const useTableLook = () => useContext(Ctx);
