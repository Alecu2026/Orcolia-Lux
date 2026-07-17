const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const svgBuf = fs.readFileSync(path.join(root, 'public/icons/icon.svg'));

async function run() {
  const iconPng = await sharp(svgBuf).resize(370, 370).png().toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4,
      background: { r: 13, g: 148, b: 136, alpha: 1 } }
  })
  .composite([{ input: iconPng, gravity: 'center' }])
  .png()
  .toFile(path.join(root, 'public/icons/icon-maskable-512.png'));
  console.log('maskable 512 done');

  const iconPng192 = await sharp(svgBuf).resize(138, 138).png().toBuffer();
  await sharp({
    create: { width: 192, height: 192, channels: 4,
      background: { r: 13, g: 148, b: 136, alpha: 1 } }
  })
  .composite([{ input: iconPng192, gravity: 'center' }])
  .png()
  .toFile(path.join(root, 'public/icons/icon-maskable-192.png'));
  console.log('maskable 192 done');
}

run().catch(console.error);
