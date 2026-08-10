import sharp from 'sharp';
import { statSync } from 'node:fs';

const jobs = [
  { src: 'public/photos/hero/4_251220-gj-92.jpeg', maxWidth: 1600, quality: 68 },
  { src: 'public/photos/hero/9_251220-gj-97.jpg', maxWidth: 1600, quality: 68 },
  { src: 'public/photos/hero/11_251220-gj-102.jpg', maxWidth: 1600, quality: 68 },
  { src: 'public/photos/monogram.png', maxWidth: 400, quality: 90, alpha: true },
  { src: 'public/photos/1_251220-gj-50.jpg', maxWidth: 1000, quality: 80 },
  { src: 'public/photos/Gallery/5_251220-gj-73.jpg', maxWidth: 1000, quality: 80 },
  { src: 'public/photos/Venue/ceremony2.png', maxWidth: 1200, quality: 82 },
  { src: 'public/photos/Venue/reception2.png', maxWidth: 1200, quality: 82 },
  { src: 'public/photos/Gallery/3_251220-gj-66.jpeg', maxWidth: 1600, quality: 78 },
  { src: 'public/photos/End Picture/2_251220-gj-61.jpg', maxWidth: 1600, quality: 78 },
];

for (const job of jobs) {
  const before = statSync(job.src).size;
  const outPath = job.src.replace(/\.(png|jpe?g)$/i, '.webp');
  await sharp(job.src)
    .resize({ width: job.maxWidth, withoutEnlargement: true })
    .webp({ quality: job.quality, alphaQuality: job.alpha ? 90 : undefined })
    .toFile(outPath);
  const after = statSync(outPath).size;
  console.log(
    `${job.src} -> ${outPath}  ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`
  );
}
