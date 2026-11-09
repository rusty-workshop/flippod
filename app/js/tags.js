// Audio metadata reader: ID3v2.2-2.4, ID3v1, MP4/M4A, FLAC, Ogg Vorbis/Opus.
// Reads only the bytes it needs from a File/Blob.

const GENRES = ['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','AlternRock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychedelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock'];

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

async function bytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const str = (b, o, n) => latin1.decode(b.subarray(o, o + n));
const clean = (s) => (s || '').replace(/\u0000+$/g, '').split('\u0000')[0].trim();

export async function readTags(file) {
  const head = await bytes(file, 0, 12);
  const sig = str(head, 0, 4);
  let t = {};
  try {
    if (sig.startsWith('ID3')) t = await id3v2(file, head);
    else if (sig === 'fLaC') t = await flac(file);
    else if (sig === 'OggS') t = await ogg(file);
    else if (str(head, 4, 4) === 'ftyp') t = await mp4(file);
    if (!t.title && /\.mp3$/i.test(file.name)) Object.assign(t, await id3v1(file), t);
  } catch (e) {
    t.error = String(e);
  }
  return t;
}

// ---------- ID3v2 ----------
async function id3v2(file, head) {
  const ver = head[3];
  const flags = head[5];
  const size = syncsafe(head, 6);
  const raw = await bytes(file, 10, 10 + Math.min(size, 16 * 1024 * 1024));
  let b = raw;
  if (ver < 4 && (flags & 0x80)) b = unsync(raw);
  let o = 0;
  if (flags & 0x40) o = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4;
  const t = {};
  const pics = [];
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  while (o + hdrLen < b.length) {
    const id = str(b, o, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsize;
    if (ver === 2) fsize = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
    else if (ver === 4) fsize = syncsafe(b, o + 4);
    else fsize = be32(b, o + 4);
    const fflags = ver === 2 ? 0 : b[o + 9];
    let data = b.subarray(o + hdrLen, o + hdrLen + fsize);
    o += hdrLen + fsize;
    if (fsize <= 0) continue;
    if (ver === 4) {
      if (fflags & 0x01) data = data.subarray(4); // data length indicator
      if (fflags & 0x02) data = unsync(data);
      if (fflags & 0x0c) continue; // compressed/encrypted
    }
    switch (id) {
      case 'TIT2': case 'TT2': t.title = text(data); break;
      case 'TPE1': case 'TP1': t.artist = text(data); break;
      case 'TPE2': case 'TP2': t.albumArtist = text(data); break;
      case 'TALB': case 'TAL': t.album = text(data); break;
      case 'TCON': case 'TCO': t.genre = genre(text(data)); break;
      case 'TRCK': case 'TRK': t.track = parseInt(text(data), 10) || 0; break;
      case 'TPOS': case 'TPA': t.disc = parseInt(text(data), 10) || 0; break;
      case 'TYER': case 'TYE': case 'TDRC': t.year = parseInt(text(data), 10) || 0; break;
      case 'TCMP': case 'TCP': t.compilation = text(data) === '1'; break;
      case 'APIC': case 'PIC': { const p = apic(data, ver); if (p) pics.push(p); break; }
    }
  }
  if (pics.length) {
    const p = pics.find((x) => x.type === 3) || pics[0];
    t.picture = new Blob([p.data], { type: p.mime });
  }
  return t;
}

function unsync(b) {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decode(enc, b) {
  switch (enc) {
    case 0: return latin1.decode(b);
    case 1:
      if (b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2));
      if (b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2));
      return utf16le.decode(b);
    case 2: return utf16be.decode(b);
    default: return utf8.decode(b);
  }
}
const text = (d) => clean(decode(d[0], d.subarray(1)));

function genre(g) {
  const m = /^\((\d+)\)(.*)$/.exec(g);
  if (m) return m[2] || GENRES[+m[1]] || g;
  if (/^\d+$/.test(g)) return GENRES[+g] || g;
  return g;
}

// find end of a null-terminated string in given encoding, return index after terminator
function skipStr(b, o, enc) {
  if (enc === 1 || enc === 2) {
    while (o + 1 < b.length && !(b[o] === 0 && b[o + 1] === 0)) o += 2;
    return o + 2;
  }
  while (o < b.length && b[o] !== 0) o++;
  return o + 1;
}

function apic(d, ver) {
  const enc = d[0];
  let o = 1;
  let mime;
  if (ver === 2) {
    const f = str(d, 1, 3).toUpperCase();
    mime = f === 'PNG' ? 'image/png' : 'image/jpeg';
    o = 4;
  } else {
    const e = skipStr(d, 1, 0);
    mime = str(d, 1, e - 2) || 'image/jpeg';
    if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase();
    o = e;
  }
  const type = d[o++];
  o = skipStr(d, o, enc);
  if (o >= d.length) return null;
  return { mime, type, data: d.slice(o) };
}

// ---------- ID3v1 ----------
async function id3v1(file) {
  if (file.size < 128) return {};
  const b = await bytes(file, file.size - 128, file.size);
  if (str(b, 0, 3) !== 'TAG') return {};
  const s = (o, n) => clean(latin1.decode(b.subarray(o, o + n)));
  const t = { title: s(3, 30), artist: s(33, 30), album: s(63, 30), year: parseInt(s(93, 4), 10) || 0 };
  if (b[125] === 0 && b[126]) t.track = b[126];
  if (GENRES[b[127]]) t.genre = GENRES[b[127]];
  for (const k of Object.keys(t)) if (!t[k]) delete t[k];
  return t;
}

// ---------- Vorbis comments (FLAC / Ogg) ----------
function vorbisComments(b, o, t) {
  const vlen = le32(b, o); o += 4 + vlen;
  const n = le32(b, o); o += 4;
  for (let i = 0; i < n && o + 4 <= b.length; i++) {
    const len = le32(b, o); o += 4;
    const s = utf8.decode(b.subarray(o, o + len)); o += len;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase();
    const v = s.slice(eq + 1).trim();
    switch (k) {
      case 'TITLE': t.title ??= v; break;
      case 'ARTIST': t.artist ??= v; break;
      case 'ALBUMARTIST': case 'ALBUM ARTIST': t.albumArtist ??= v; break;
      case 'ALBUM': t.album ??= v; break;
      case 'GENRE': t.genre ??= v; break;
      case 'TRACKNUMBER': t.track ??= parseInt(v, 10) || 0; break;
      case 'DISCNUMBER': t.disc ??= parseInt(v, 10) || 0; break;
      case 'DATE': case 'YEAR': t.year ??= parseInt(v, 10) || 0; break;
      case 'COMPILATION': t.compilation = v === '1'; break;
      case 'METADATA_BLOCK_PICTURE':
        if (!t.picture) {
          try {
            const bin = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
            t.picture = flacPicture(bin);
          } catch (e) { /* ignore bad picture */ }
        }
        break;
    }
  }
}

function flacPicture(b) {
  let o = 4;
  const ml = be32(b, o); o += 4;
  const mime = str(b, o, ml); o += ml;
  const dl = be32(b, o); o += 4 + dl + 16;
  const len = be32(b, o); o += 4;
  return new Blob([b.slice(o, o + len)], { type: mime || 'image/jpeg' });
}

async function flac(file) {
  const t = {};
  let o = 4;
  for (let guard = 0; guard < 64 && o + 4 < file.size; guard++) {
    const h = await bytes(file, o, o + 4);
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4 || (type === 6 && !t.picture)) {
      const b = await bytes(file, o + 4, o + 4 + len);
      if (type === 4) vorbisComments(b, 0, t);
      else t.picture = flacPicture(b);
    }
    o += 4 + len;
    if (last) break;
  }
  return t;
}

async function ogg(file) {
  // Reassemble the first few packets from Ogg pages (comment header may span pages).
  const b = await bytes(file, 0, Math.min(file.size, 2 * 1024 * 1024));
  const packets = [];
  let cur = [];
  let o = 0;
  while (o + 27 < b.length && packets.length < 3) {
    if (str(b, o, 4) !== 'OggS') break;
    const nseg = b[o + 26];
    const segs = b.subarray(o + 27, o + 27 + nseg);
    let p = o + 27 + nseg;
    for (const s of segs) {
      cur.push(b.subarray(p, p + s));
      p += s;
      if (s < 255) {
        const total = cur.reduce((a, x) => a + x.length, 0);
        const pk = new Uint8Array(total);
        let q = 0;
        for (const x of cur) { pk.set(x, q); q += x.length; }
        packets.push(pk);
        cur = [];
      }
    }
    o = p;
  }
  const t = {};
  for (const pk of packets) {
    if (pk[0] === 3 && str(pk, 1, 6) === 'vorbis') vorbisComments(pk, 7, t);
    else if (str(pk, 0, 8) === 'OpusTags') vorbisComments(pk, 8, t);
  }
  return t;
}

// ---------- MP4 ----------
async function mp4(file) {
  // walk top-level atoms to find moov
  let o = 0;
  let moov = null;
  for (let guard = 0; guard < 64 && o + 8 <= file.size; guard++) {
    const h = await bytes(file, o, o + 16);
    let size = be32(h, 0);
    const type = str(h, 4, 4);
    let hdr = 8;
    if (size === 1) { size = be32(h, 8) * 4294967296 + be32(h, 12); hdr = 16; }
    else if (size === 0) size = file.size - o;
    if (size < 8) break;
    if (type === 'moov') { moov = await bytes(file, o + hdr, o + Math.min(size, 24 * 1024 * 1024)); break; }
    o += size;
  }
  const t = {};
  if (!moov) return t;
  const find = (b, path) => {
    let s = 0, e = b.length;
    for (const name of path) {
      let found = false;
      let p = s;
      while (p + 8 <= e) {
        const sz = be32(b, p);
        const ty = str(b, p + 4, 4);
        if (sz < 8) break;
        if (ty === name) {
          s = p + 8 + (name === 'meta' ? 4 : 0);
          e = p + sz;
          found = true;
          break;
        }
        p += sz;
      }
      if (!found) return null;
    }
    return [s, e];
  };
  const r = find(moov, ['udta', 'meta', 'ilst']);
  if (!r) return t;
  let p = r[0];
  while (p + 8 <= r[1]) {
    const sz = be32(moov, p);
    if (sz < 8) break;
    const key = str(moov, p + 4, 4);
    // data atom inside
    const d = p + 8;
    if (str(moov, d + 4, 4) === 'data') {
      const dsz = be32(moov, d);
      const dtype = be32(moov, d + 8) & 0xffffff;
      const payload = moov.subarray(d + 16, d + dsz);
      const txt = () => utf8.decode(payload).trim();
      switch (key) {
        case '©nam': t.title = txt(); break;
        case '©ART': t.artist = txt(); break;
        case 'aART': t.albumArtist = txt(); break;
        case '©alb': t.album = txt(); break;
        case '©gen': t.genre = txt(); break;
        case 'gnre': t.genre = GENRES[((payload[0] << 8) | payload[1]) - 1] || t.genre; break;
        case 'trkn': t.track = (payload[2] << 8) | payload[3]; break;
        case 'disk': t.disc = (payload[2] << 8) | payload[3]; break;
        case '©day': t.year = parseInt(txt(), 10) || 0; break;
        case 'cpil': t.compilation = payload[0] === 1; break;
        case 'covr':
          if (!t.picture) t.picture = new Blob([payload.slice()], { type: dtype === 14 ? 'image/png' : 'image/jpeg' });
          break;
      }
    }
    p += sz;
  }
  return t;
}
