import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM Proiecte",
    short_name: "CRM",
    description: "Gestionare proiecte, task-uri și tichete — rapid și simplu.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    orientation: "portrait",
    background_color: "#0d9488",
    theme_color: "#0d9488",
    lang: "ro",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png",          sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png",          sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg",              sizes: "any",      type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      {
        name: "Task nou",
        short_name: "Task nou",
        url: "/tasks?create=task",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Tichet nou",
        short_name: "Tichet nou",
        url: "/tickets?create=ticket",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Proiecte",
        short_name: "Proiecte",
        url: "/projects",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
