import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AquaCRM",
    short_name: "AquaCRM",
    description: "Gestionare proiecte, sarcini și cereri — rapid și simplu.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    orientation: "portrait",
    background_color: BRAND.navy,
    theme_color: BRAND.brand,
    lang: "ro",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png",          sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png",          sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Sarcină nouă",
        short_name: "Sarcină nouă",
        url: "/tasks?create=task",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Cerere nouă",
        short_name: "Cerere nouă",
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
