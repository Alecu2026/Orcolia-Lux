// Ferestrele (pop-up) ale hărții: HTML simplu, stilat prin clasele `.mp-*` din globals.css (teme deschisă / închisă, colțuri rotunjite, butoane mari). Cod partajat, fără server-only.

export const esc = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type MapLabels = { navigate: string };

/** „Navighează: Google Maps · Waze · Apple Maps” — linkuri către aplicațiile de hartă, ca butoane mici. */
export function navHtml(lat: number, lng: number, label = "Navighează"): string {
  return `
    <div class="mp-nav">
      <span class="mp-nav-label">🧭 ${esc(label)}</span>
      <a class="mp-pill" href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer">Google</a>
      <a class="mp-pill" href="https://waze.com/ul?ll=${lat},${lng}&navigate=yes" target="_blank" rel="noopener noreferrer">Waze</a>
      <a class="mp-pill" href="https://maps.apple.com/?ll=${lat},${lng}" target="_blank" rel="noopener noreferrer">Apple</a>
    </div>`;
}

export type CardOptions = {
  /** culoarea punctului din titlu (starea) */
  dot?: string;
  /** mică etichetă înaintea titlului (ex. #012, contor) */
  tag?: string;
  title: string;
  /** subtitlu (ex. abonat) */
  subtitle?: string;
  /** rânduri cu pictogramă: [pictogramă, text] */
  lines?: [string, string][];
  /** etichetă de stare colorată: [text, culoare] */
  pills?: [string, string][];
  /** butoane principale: [text, href] */
  actions?: [string, string][];
  footerHtml?: string;
};

/** Fereastra unui punct: titlu clar (cu culoare de stare), detalii pe rânduri, butoane de acțiune și navigare. Textele primite sunt escapate aici. */
export function cardHtml(o: CardOptions): string {
  return `
    <div class="mp">
      <div class="mp-head">
        ${o.dot ? `<span class="mp-dot" style="background:${esc(o.dot)}"></span>` : ""}
        <div class="mp-titles">
          <div class="mp-title">${o.tag ? `<span class="mp-tag">${esc(o.tag)}</span>` : ""}${esc(o.title)}</div>
          ${o.subtitle ? `<div class="mp-sub">${esc(o.subtitle)}</div>` : ""}
        </div>
      </div>
      ${o.pills?.length ? `<div class="mp-pills">${o.pills.map(([t, c]) => `<span class="mp-status" style="--c:${esc(c)}">${esc(t)}</span>`).join("")}</div>` : ""}
      ${o.lines?.length ? `<div class="mp-lines">${o.lines.map(([i, t]) => `<div class="mp-line"><span aria-hidden="true">${i}</span><span>${esc(t)}</span></div>`).join("")}</div>` : ""}
      ${o.actions?.length ? `<div class="mp-actions">${o.actions.map(([t, h], i) => `<a class="mp-btn ${i === 0 ? "mp-btn-primary" : ""}" href="${esc(h)}">${esc(t)}</a>`).join("")}</div>` : ""}
      ${o.footerHtml ?? ""}
    </div>`;
}

export type ListItem = { dot?: string; title: string; subtitle?: string; href: string };

/** Lista dintr-un grup de puncte (la același loc / zoom maxim): rânduri cu punct colorat și săgeată. */
export function listHtml(heading: string, items: ListItem[]): string {
  return `
    <div class="mp mp-list">
      <div class="mp-list-head">${esc(heading)}</div>
      <div class="mp-list-body">
        ${items
          .map(
            (i) => `
          <a class="mp-row" href="${esc(i.href)}">
            ${i.dot ? `<span class="mp-dot" style="background:${esc(i.dot)}"></span>` : ""}
            <span class="mp-row-text"><span class="mp-row-title">${esc(i.title)}</span>${i.subtitle ? `<span class="mp-row-sub">${esc(i.subtitle)}</span>` : ""}</span>
            <span class="mp-row-go" aria-hidden="true">→</span>
          </a>`,
          )
          .join("")}
      </div>
    </div>`;
}

/** Eticheta mică la trecerea mouse-ului peste un punct: doar numele (fără a deschide fereastra). */
export const hoverHtml = (title: string, sub?: string): string => `<div class="mp-hover"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>`;
