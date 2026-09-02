import type { MetadataRoute } from 'next';

const SITE = 'https://kr-museum-now.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/map`, changeFrequency: 'weekly', priority: 0.9 },
  ];
}
