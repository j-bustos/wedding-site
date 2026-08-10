import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontDir = join(__dirname, 'og-fonts');
const outDir = join(__dirname, '..', 'public', 'og');

mkdirSync(outDir, { recursive: true });

const fonts = [
  { name: 'Playfair Display', data: readFileSync(join(fontDir, 'PlayfairDisplay-Bold.ttf')), weight: 700, style: 'normal' },
  { name: 'Cormorant Garamond', data: readFileSync(join(fontDir, 'CormorantGaramond-Italic.ttf')), weight: 400, style: 'italic' },
  { name: 'Cormorant Garamond', data: readFileSync(join(fontDir, 'CormorantGaramond-SemiBold.ttf')), weight: 600, style: 'normal' },
  { name: 'Jost', data: readFileSync(join(fontDir, 'Jost-Light.ttf')), weight: 300, style: 'normal' },
  { name: 'Jost', data: readFileSync(join(fontDir, 'Jost-Regular.ttf')), weight: 400, style: 'normal' },
];

const GREEN = '#1e3a2f';
const CREAM = '#f0e6c8';

function card({ background, color, title, titleFont = 'Playfair Display', titleWeight = 700, subtitle, tagline }) {
  return {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background,
        color,
        fontFamily: 'Jost',
        padding: '80px',
        textAlign: 'center',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { fontFamily: titleFont, fontWeight: titleWeight, fontSize: '108px', lineHeight: 1.05, marginBottom: '28px' },
            children: title,
          },
        },
        subtitle && {
          type: 'div',
          props: {
            style: { fontFamily: 'Cormorant Garamond', fontStyle: 'italic', fontSize: '40px', marginBottom: '18px', opacity: 0.9 },
            children: subtitle,
          },
        },
        tagline && {
          type: 'div',
          props: {
            style: { fontFamily: 'Jost', fontWeight: 300, fontSize: '24px', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 },
            children: tagline,
          },
        },
      ].filter(Boolean),
    },
  };
}

const pages = [
  {
    slug: 'home',
    element: card({
      background: GREEN,
      color: CREAM,
      title: 'The Bustos',
      titleFont: 'Cormorant Garamond',
      titleWeight: 600,
      subtitle: 'December 18, 2026',
      tagline: 'McAllen, TX',
    }),
  },
  {
    slug: 'schedule',
    element: card({
      background: GREEN,
      color: CREAM,
      title: 'The Day Of',
      subtitle: 'Ceremony 3:00 PM · Reception 6:00 PM',
      tagline: 'December 18, 2026 — McAllen & Donna, TX',
    }),
  },
  {
    slug: 'rsvp',
    element: card({
      background: GREEN,
      color: CREAM,
      title: 'Kindly Reply',
      subtitle: 'Please RSVP by November 18, 2026',
      tagline: 'The Bustos Wedding',
    }),
  },
  {
    slug: 'hotels',
    element: card({
      background: GREEN,
      color: CREAM,
      title: 'Where to Stay',
      subtitle: 'McAllen, TX',
      tagline: 'The Bustos Wedding — December 18, 2026',
    }),
  },
  {
    slug: 'dress-code',
    element: card({
      background: '#000000',
      color: '#ffffff',
      title: 'ALL BLACK',
      titleFont: 'Playfair Display',
      titleWeight: 700,
      subtitle: 'Formal attire, head to toe in black.',
      tagline: 'The Bustos Wedding',
    }),
  },
];

for (const page of pages) {
  const svg = await satori(page.element, { width: 1200, height: 630, fonts });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();
  writeFileSync(join(outDir, `${page.slug}.png`), png);
  console.log(`Generated public/og/${page.slug}.png`);
}
