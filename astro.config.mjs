import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://bustos-jamal.github.io',
  base: '/wedding-site',
  integrations: [mdx()],
});
