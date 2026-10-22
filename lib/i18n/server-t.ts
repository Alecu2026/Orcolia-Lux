import "server-only";
import { getLocaleFromCookie } from "./locale-cookie";
import { makeT, type TFn } from "./t";

/** Pentru componentele de server: `const t = await getT();` apoi `t("Caută")`. */
export async function getT(): Promise<TFn> {
  return makeT(await getLocaleFromCookie());
}
