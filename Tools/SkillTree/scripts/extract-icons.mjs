// Extract only the library icons we use; never ship the full 6 MB icon set.
import { readFileSync, writeFileSync } from 'node:fs';
const source = JSON.parse(readFileSync(new URL('../node_modules/@iconify-json/game-icons/icons.json', import.meta.url), 'utf8'));
const names = ['machine-gun', 'machine-gun-magazine', 'crosshair', 'supersonic-bullet'];
const icons = Object.fromEntries(names.map(name => {
  if (!source.icons[name]) throw new Error(`Missing icon: ${name}`);
  return [name, source.icons[name].body];
}));
writeFileSync(new URL('../src/game-icons.json', import.meta.url), JSON.stringify(icons, null, 2) + '\n');
