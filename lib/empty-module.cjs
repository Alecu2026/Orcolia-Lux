// Modul gol pentru browser: pachetul de voce (@diffusionstudio/vits-web) face require("fs") / require("path") doar pe ramura de server (Node); în browser nu se apelează niciodată.
// Folosit de next.config.mjs → turbopack.resolveAlias, ca `npm run dev` (Turbopack) să compileze paginile cu vocea (Notificări, PBX). Build-ul de producție (webpack) nu are nevoie de el.
module.exports = {};
