import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/monitor", "/solar", "/wind", "/grid", "/players", "/explore", "/open-data", "/methodology"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "daily",
  }));
}
