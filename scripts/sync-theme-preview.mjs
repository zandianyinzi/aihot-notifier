import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const popupPath = path.join(projectRoot, 'popup.html');
const previewPath = path.join(projectRoot, 'theme-comparison-preview.html');
const preview = fs.readFileSync(previewPath, 'utf8');
const popup = fs.readFileSync(popupPath, 'utf8');
const declaration = 'const popupTemplate = ';
const start = preview.indexOf(declaration);
const endMarker = ';\n    const themes';
const end = start === -1 ? -1 : preview.indexOf(endMarker, start + declaration.length);

if (start === -1 || end === -1) {
  throw new Error('Could not locate popupTemplate in theme-comparison-preview.html');
}

const literalStart = start + declaration.length;
const nextPreview = `${preview.slice(0, literalStart)}${JSON.stringify(popup)}${preview.slice(end)}`;
fs.writeFileSync(previewPath, nextPreview);
console.log(`Synchronized popupTemplate from popup.html (${popup.length} bytes).`);
