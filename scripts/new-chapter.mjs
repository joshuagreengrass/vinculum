#!/usr/bin/env node
// Crea un capítulo nuevo: agrega la entrada en data/chapters.json y los
// archivos chapters/es/NN.md y chapters/en/NN.md vacíos.
//
// Uso:
//   node scripts/new-chapter.mjs --es "Título" --en "Title" [--date 2026-10-12] [--cover media/covers/06.mp4]
//
// Después: escribí los .md, poné la portada en media/covers/ y hacé commit + push.

import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map((s) => {
    const [k, ...v] = s.split(' ');
    return [k, v.join(' ').replace(/^"|"$/g, '')];
  }),
);

const dataPath = path.join(root, 'data/chapters.json');
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const number = Math.max(0, ...data.chapters.map((c) => c.number)) + 1;
const id = String(number).padStart(2, '0');
const today = new Date().toISOString().slice(0, 10);

const entry = {
  id,
  number,
  date: args.date || today,
  cover: args.cover || `media/covers/${id}.jpg`,
  title: { es: args.es || `Capítulo ${id}`, en: args.en || args.es || `Chapter ${id}` },
  summary: { es: args['summary-es'] || '', en: args['summary-en'] || '' },
  file: { es: `chapters/es/${id}.md`, en: `chapters/en/${id}.md` },
};

data.chapters.push(entry);
await writeFile(dataPath, JSON.stringify(data, null, 2) + '\n');

for (const lang of ['es', 'en']) {
  const file = path.join(root, entry.file[lang]);
  try { await access(file); } catch { await writeFile(file, ''); }
}

console.log(`Capítulo ${id} creado.`);
console.log(`  · Texto:   ${entry.file.es}  /  ${entry.file.en}`);
console.log(`  · Portada: ${entry.cover}`);
