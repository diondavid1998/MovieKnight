import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSvg = path.join(repoRoot, 'design', 'whatson-icon.svg');

const iosIconDir = path.join(repoRoot, 'WhatsOn', 'Assets.xcassets', 'AppIcon.appiconset');
const logoDir = path.join(repoRoot, 'WhatsOn', 'Assets.xcassets', 'WhatsOnLogo.imageset');
const composerDir = path.join(repoRoot, 'WhatsOn', 'WhatsOn.icon', 'Assets');

// The darkest stop of the plate gradient. Flattening onto anything else
// leaves a seam where the artwork's own edge meets the backing colour.
const PLATE_FLOOR = '#120C04';

const pngOutputs = [
  { file: path.join(iosIconDir, 'AppIcon.png'), size: 1024 },
  { file: path.join(iosIconDir, 'Icon-iphone-20x20-2x.png'), size: 40 },
  { file: path.join(iosIconDir, 'Icon-iphone-20x20-3x.png'), size: 60 },
  { file: path.join(iosIconDir, 'Icon-iphone-29x29-2x.png'), size: 58 },
  { file: path.join(iosIconDir, 'Icon-iphone-29x29-3x.png'), size: 87 },
  { file: path.join(iosIconDir, 'Icon-iphone-40x40-2x.png'), size: 80 },
  { file: path.join(iosIconDir, 'Icon-iphone-40x40-3x.png'), size: 120 },
  { file: path.join(iosIconDir, 'Icon-iphone-60x60-2x.png'), size: 120 },
  { file: path.join(iosIconDir, 'Icon-iphone-60x60-3x.png'), size: 180 },
  { file: path.join(iosIconDir, 'Icon-ipad-20x20-1x.png'), size: 20 },
  { file: path.join(iosIconDir, 'Icon-ipad-20x20-2x.png'), size: 40 },
  { file: path.join(iosIconDir, 'Icon-ipad-29x29-1x.png'), size: 29 },
  { file: path.join(iosIconDir, 'Icon-ipad-29x29-2x.png'), size: 58 },
  { file: path.join(iosIconDir, 'Icon-ipad-40x40-1x.png'), size: 40 },
  { file: path.join(iosIconDir, 'Icon-ipad-40x40-2x.png'), size: 80 },
  { file: path.join(iosIconDir, 'Icon-ipad-76x76-1x.png'), size: 76 },
  { file: path.join(iosIconDir, 'Icon-ipad-76x76-2x.png'), size: 152 },
  { file: path.join(iosIconDir, 'Icon-ipad-83_5x83_5-2x.png'), size: 167 },
  // The in-app brand mark is the same artwork; generating it here is what
  // keeps the header logo and the home screen from drifting apart.
  { file: path.join(logoDir, 'WhatsOn.png'), size: 1254 },
];

// Supersample: rasterise the vector at four times the target and let Lanczos
// do the reduction. Rendering straight to 20 px puts the spark's curves at the
// mercy of one row of pixels; downscaling from a fixed 1024 oversamples the
// large icons for nothing. Four times, capped, is the useful middle.
//
// sharp renders an SVG at 72 dpi by default, and this artwork's user units are
// its 1024 px canvas — so `density` is just the scale factor in dpi terms.
const SUPERSAMPLE = 4;
const MAX_RENDER = 2048;

function densityFor(size) {
  const render = Math.min(MAX_RENDER, size * SUPERSAMPLE);
  return Math.max(1, (render / 1024) * 72);
}

async function buildOpaquePng(size) {
  return sharp(sourceSvg, { density: densityFor(size) })
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .flatten({ background: PLATE_FLOOR })
    .removeAlpha()
    .png()
    .toBuffer();
}

for (const output of pngOutputs) {
  const png = await buildOpaquePng(output.size);
  await fs.writeFile(output.file, png);
}

// --- Icon Composer layers -------------------------------------------------
//
// The .icon bundle wants the plate and the mark as separate images. Rather
// than keep a second copy of the artwork, hide one group of the master with
// an injected stylesheet and rasterise what is left. Same paths, same
// gradients, no way for the two to disagree.

const masterSvg = await fs.readFile(sourceSvg, 'utf8');

function svgWithOverrides(css) {
  return Buffer.from(masterSvg.replace('</defs>', `</defs>\n  <style>${css}</style>`));
}

const COMPOSER_SIZE = 1024;

const composerLayers = [
  // Background: the plate alone, opaque, in both system appearances.
  { file: 'Background.png', css: '#mark-layer{display:none}', opaque: true },
  {
    file: 'Background-Dark.png',
    css: '#mark-layer{display:none} #plate-base{fill:url(#plateDark)}',
    opaque: true,
  },
  // Foreground: the mark alone on transparency, so the glass system can
  // light it. Flattening this one would defeat the whole layer.
  { file: 'Foreground.png', css: '#plate-layer{display:none}', opaque: false },
];

for (const layer of composerLayers) {
  let pipeline = sharp(svgWithOverrides(layer.css), { density: densityFor(COMPOSER_SIZE) })
    .resize(COMPOSER_SIZE, COMPOSER_SIZE, { fit: 'fill', kernel: 'lanczos3' });
  if (layer.opaque) pipeline = pipeline.flatten({ background: PLATE_FLOOR }).removeAlpha();
  await fs.writeFile(path.join(composerDir, layer.file), await pipeline.png().toBuffer());
}

const total = pngOutputs.length + composerLayers.length;
console.log(`Generated ${total} PNG files from ${path.relative(repoRoot, sourceSvg)}`);
