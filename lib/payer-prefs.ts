/** Cookie-uri citite de server la randarea /platitori (ca prima afișare să știe deja ce vrea utilizatorul). */
/** Câte rânduri pe pagină a ales utilizatorul (inclusiv „Toate") — așa lista apare completă din prima, fără să aștepte JS. */
export const PAYERS_PP_COOKIE = "payers-pp";
/** Versiunea listei pe care o are deja browserul (în IndexedDB): dacă e cea curentă, serverul nu mai cere descărcarea ei din nou. */
export const PAYERS_V_COOKIE = "payers-v";

/** La fel pentru /invoices: câte pe pagină (inclusiv „Toate") și versiunea listei de facturi din IndexedDB. */
export const INVOICES_PS_COOKIE = "invoices-ps";
export const INVOICES_V_COOKIE = "invoices-v";

/** La fel pentru /contoare: câte rânduri pe pagină (inclusiv „Toate") și versiunea listei de contoare din IndexedDB. */
export const METERS_PP_COOKIE = "meters-pp";
export const METERS_V_COOKIE = "meters-v";
