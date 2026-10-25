/** Șablon de cerere pentru clienții din cabinetul personal (creat de administrator). Cod comun server + browser. */
export type PortalTemplate = { id: string; name: string; title: string; description: string };

export const PORTAL_TEMPLATE_MAX = 50;
export const PORTAL_TEMPLATE_MAX_NAME = 80;
export const PORTAL_TEMPLATE_MAX_TITLE = 200;
export const PORTAL_TEMPLATE_MAX_DESCRIPTION = 2000;
