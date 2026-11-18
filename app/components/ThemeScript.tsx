"use client";

// Evită flash-ul de temă: aplică .dark înainte de hydration.
const themeScript = `
(function(){try{
  var t=localStorage.getItem('theme');
  var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(d)document.documentElement.classList.add('dark');
}catch(e){}})();
`;

/**
 * Scriptul inline de temă. Pe server (HTML-ul trimis) e un <script> obișnuit și rulează imediat.
 * În browser, la o re-randare pe client, React 19 avertizează („Encountered a script tag while rendering React component”)
 * pentru orice <script> executabil; scriptul a rulat deja din HTML-ul serverului, așa că acolo îl marcăm ca date
 * (type="application/json"), ceea ce nu mai declanșează avertismentul și nici nu execută nimic a doua oară.
 * Diferența de atribut la hidratare e așteptată (suppressHydrationWarning).
 */
export function ThemeScript({ nonce }: { nonce?: string }) {
  return (
    <script
      nonce={nonce}
      type={typeof window === "undefined" ? undefined : "application/json"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: themeScript }}
    />
  );
}
