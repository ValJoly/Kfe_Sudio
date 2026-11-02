import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kfe Studio",
    short_name: "Kfe Studio",
    description: "Your fabric, pattern, and sewing project library.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf9f5",
    theme_color: "#526e5a",
  };
}
