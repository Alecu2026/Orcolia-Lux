/** Cookie-uri citite de server la randarea /platitori (ca prima afișare să știe deja ce vrea utilizatorul). */
/** Câte rânduri pe pagină a ales utilizatorul (inclusiv „Toate") — așa lista apare completă din prima, fără să aștepte JS. */
export const PAYERS_PP_COOKIE = "payers-pp";
/** Versiunea listei pe care o are deja browserul (în IndexedDB): dacă e cea curentă, serverul nu mai cere descărcarea ei din nou. */
export const PAYERS_V_COOKIE = "payers-v";
