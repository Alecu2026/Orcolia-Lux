// La pornirea serverului: scadența facturilor Apă-Canal se aduce imediat la ziua de 25 a lunii facturii, fără să așteptăm cron-ul sau un import.
// Rulează în fundal (register trebuie să se termine înainte ca serverul să primească cereri), o singură dată pe proces; fără nimic de corectat
// costă o singură interogare.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Pe Vercel fiecare instanță nouă ar rula interogarea (cold start-uri dese, bază de date partajată): acolo scadențele le aduce la zi cron-ul zilnic.
  if (process.env.VERCEL) return;
  setTimeout(() => {
    import("./lib/services/apa-canal-due")
      .then((m) => m.normalizeApaCanalDueDates())
      .catch((e) => console.error("[startup] scadența facturilor Apă-Canal:", e));
  }, 3000);

  // Reamintirile sarcinilor programate la o oră anume (o singură dată / zilnic / săptămânal / lunar / la interval) au nevoie de o verificare deasă. Pe un server propriu
  // o face procesul însuși, la fiecare minut (idempotent: o reamintire se „revendică” atomic, deci nu pleacă de două ori nici dacă rulează și un cron extern).
  // Dezactivare: DISABLE_TASK_REMINDER_TIMER=1. Pe Vercel (fără proces permanent) se apelează /api/cron/reminders din cron la 5–15 minute.
  if (process.env.DISABLE_TASK_REMINDER_TIMER === "1") return;
  setTimeout(() => {
    // Sarcini + programări (reamintiri noi) + reminderele vechi ale programărilor către clienți (până acum le procesa doar cron-ul extern).
    const tick = () =>
      Promise.all([import("./lib/services/tasks"), import("./lib/services/appointment-reminders"), import("./lib/services/reminders"), import("./lib/delivery-log")])
        .then(([tasks, appts, legacy, d]) =>
          d.withDeliveryMeta({ source: "timer" }, () =>
            Promise.all([
              tasks.checkTaskReminders().catch((e) => console.error("[startup] reamintirile sarcinilor:", e)),
              appts.checkAppointmentReminders().catch((e) => console.error("[startup] reamintirile programărilor:", e)),
              legacy.processDueReminders().catch((e) => console.error("[startup] reminderele vechi ale programărilor:", e)),
            ]),
          ),
        )
        .catch((e) => console.error("[startup] reamintiri:", e));
    void tick();
    const timer = setInterval(() => void tick(), 60_000);
    timer.unref?.();
  }, 20_000);
}
