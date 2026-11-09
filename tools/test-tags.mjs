import { readTags } from '../app/js/tags.js';
import { readFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2];
let n = 0, bad = 0, pics = 0;
for (const f of readdirSync(dir).filter((x) => /\.(mp3|m4a|flac|ogg|opus)$/i.test(x))) {
  const file = new File([readFileSync(`${dir}/${f}`)], f);
  const t = await readTags(file);
  n++;
  if (t.picture) pics++;
  if (!t.title || !t.artist || !t.album || t.error) { bad++; console.log('BAD', f, JSON.stringify({ ...t, picture: !!t.picture })); }
  if (n <= 3) console.log(f, '=>', JSON.stringify({ ...t, picture: t.picture && `${t.picture.type} ${t.picture.size}b` }));
}
console.log({ n, bad, pics });
