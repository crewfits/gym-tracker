import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FitKiro Scanner",
    short_name: "FitKiro Scanner",
    description: "Fast QR attendance scanning for FitKiro gyms",
    id: "/scanner",
    start_url: "/scanner",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f8fd",
    theme_color: "#102a56",
    icons: [
      { src: "/icons/fitkiro-scanner-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/fitkiro-scanner-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/fitkiro-scanner-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Open scanner", short_name: "Scanner", url: "/scanner", icons: [{ src: "/icons/fitkiro-scanner-192.png", sizes: "192x192", type: "image/png" }] }],
  };
}
