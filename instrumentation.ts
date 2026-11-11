// La pornirea serverului: scadența facturilor Apă-Canal se aduce imediat la ziua de 25 a lunii facturii, fără să așteptăm cron-ul sau un import.
// Rulează în fundal (register trebuie să se termine înainte ca serverul să primească cereri), o singură dată pe proces; fără nimic de corectat
// costă o singură interogare.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // folderele pentru fișiere (sarcini / cereri / contoare) există pe disc încă de la pornire
  // (pe Vercel sistemul de fișiere e doar pentru citire, iar fișierele merg în stocarea externă: nu e nimic de creat — altfel fiecare pornire la rece scria o eroare ENOENT în jurnal)
  if (!process.env.VERCEL) import("./lib/storage").then((m) => m.ensureStorageDirs()).catch((e) => console.error("[startup] folderele de fișiere:", e));
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
      Promise.all([import("./lib/services/tasks"), import("./lib/services/appointment-reminders"), import("./lib/services/reminders"), import("./lib/delivery-log"), import("./lib/services/contract-expiry"), import("./lib/services/metrology-expiry"), import("./lib/services/meter-issue-deadlines"), import("./lib/services/lorawan"), import("./lib/services/notify-schedules")])
        .then(([tasks, appts, legacy, d, contracts, metrology, issues, lorawan, schedules]) =>
          d.withDeliveryMeta({ source: "timer" }, () =>
            Promise.all([
              tasks.checkTaskReminders().catch((e) => console.error("[startup] reamintirile sarcinilor:", e)),
              appts.checkAppointmentReminders().catch((e) => console.error("[startup] reamintirile programărilor:", e)),
              legacy.processDueReminders().catch((e) => console.error("[startup] reminderele vechi ale programărilor:", e)),
              // contractele care expiră (30 / 10 zile): se verifică o dată la ~25 de minute (limitat în funcție), fiecare etapă pleacă o singură dată
              contracts.checkContractExpiry().catch((e) => console.error("[startup] expirarea contractelor:", e)),
              // verificările metrologice care ajung la scadență (60 / 30 / 10 zile), tot la ~25 de minute
              metrology.checkMetrologyExpiry().catch((e) => console.error("[startup] verificările metrologice:", e)),
              // termenele de remediere ale neregulilor de contor (cu 3 zile înainte și la depășire)
              issues.checkMeterIssueDeadlines().catch((e) => console.error("[startup] termenele neregulilor de contor:", e)),
              // contoarele LoRaWAN: o dată pe zi, după ora 23:30 (ora firmei) — cele mai multe verificări costă doar o comparație de oră
              lorawan.checkLorawanSchedule().catch((e) => console.error("[startup] contoarele LoRaWAN:", e)),
              // notificările programate către plătitori / clienți (la ora aleasă, la fiecare minut se verifică ce e scadent)
              schedules.runDueNotifySchedules().catch((e) => console.error("[startup] notificările programate:", e)),
            ]),
          ),
        )
        .catch((e) => console.error("[startup] reamintiri:", e));
    void tick();
    const timer = setInterval(() => void tick(), 60_000);
    timer.unref?.();
  }, 20_000);
}
