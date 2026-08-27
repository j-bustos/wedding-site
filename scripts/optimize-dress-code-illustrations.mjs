import sharp from 'sharp';
import { statSync } from 'node:fs';

const jobs = [
  { src: 'public/dress.png', out: 'public/dress.webp' },
  { src: 'public/suit.png', out: 'public/suit.webp' },
];

for (const { src, out } of jobs) {
  const meta = await sharp(src).metadata();
  // Source is already modest (~600px tall); re-encode as WebP at native
  // size (no upscale) so it's still crisp at the ~180px max display height
  // on retina, with EXIF/XMP metadata stripped.
  await sharp(src)
    .webp({ quality: 90, effort: 6 })
    .toFile(out);
  const outSize = statSync(out).size;
  console.log(`${src} (${meta.width}x${meta.height}, ${statSync(src).size}b) -> ${out}: ${outSize}b`);
}
