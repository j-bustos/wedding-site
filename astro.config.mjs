import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://thebustos2026.com',
  integrations: [mdx()],
});
