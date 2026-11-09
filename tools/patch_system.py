#!/usr/bin/env python3
"""Build a patched KaiOS system app zip that loads Flippod's outer-screen layer.
Only index_remote.html changes (two tags added) and two files are added; every other entry is copied verbatim.
Usage: patch_system.py original.zip out.zip"""
import sys, zipfile, pathlib
src, dst = sys.argv[1], sys.argv[2]
outer = pathlib.Path(__file__).resolve().parent.parent / 'outer'
TAG_CSS = '<link rel="stylesheet" href="flippod_outer.css">'
TAG_JS = '<script defer="" src="flippod_outer.js"></script>'
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, 'w') as zo:
    names = zi.namelist()
    assert 'index_remote.html' in names, 'no index_remote.html in system zip'
    for info in zi.infolist():
        if info.filename in ('flippod_outer.js', 'flippod_outer.css'):
            continue
        data = zi.read(info.filename)
        if info.filename == 'index_remote.html':
            html = data.decode('utf-8')
            assert '</head>' in html
            html = html.replace(TAG_CSS, '').replace(TAG_JS, '')
            html = html.replace('</head>', f'  {TAG_CSS}\n    {TAG_JS}\n  </head>', 1)
            data = html.encode('utf-8')
        zo.writestr(info, data, compress_type=info.compress_type)
    for n in ('flippod_outer.js', 'flippod_outer.css'):
        zo.write(outer / n, n, compress_type=zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(dst) as z:
    bad = z.testzip()
    assert bad is None, f'corrupt entry {bad}'
    assert len(z.namelist()) == len(names) + 2 - sum(n in names for n in ('flippod_outer.js', 'flippod_outer.css'))
print('patched', dst)
