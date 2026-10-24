// La pornirea serverului: scadența facturilor Apă-Canal se aduce imediat la ziua de 25 a lunii facturii, fără să așteptăm cron-ul sau un import.
// Rulează în fundal (register trebuie să se termine înainte ca serverul să primească cereri), o singură dată pe proces; fără nimic de corectat
// costă o singură interogare.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(() => {
    import("./lib/services/apa-canal-due")
      .then((m) => m.normalizeApaCanalDueDates())
      .catch((e) => console.error("[startup] scadența facturilor Apă-Canal:", e));
  }, 3000);
}
