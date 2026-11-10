from pathlib import Path
from PIL import Image, ImageDraw
import zipfile, json
root = Path(__file__).resolve().parents[1]
(root / 'icons').mkdir(exist_ok=True)
for size in [16, 32, 48, 128]:
    scale = 4
    im = Image.new('RGBA', (size*scale, size*scale), (0,0,0,0))
    d = ImageDraw.Draw(im)
    s = size * scale
    d.rounded_rectangle((0,0,s-1,s-1), radius=s*.23, fill='#18263f')
    d.ellipse((s*.2,s*.16,s*.68,s*.64),outline='#9abbff',width=max(3,int(s*.08)))
    d.line((s*.61,s*.59,s*.8,s*.8),fill='#9abbff',width=max(3,int(s*.1)))
    d.ellipse((s*.36,s*.30,s*.43,s*.37),fill='#79d7ad')
    im.resize((size,size),Image.Resampling.LANCZOS).save(root/'icons'/f'icon{size}.png')
manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
files = ['manifest.json','background.js','core.mjs','dashboard.html','dashboard.js','styles.css','README.md'] + [f'icons/icon{s}.png' for s in [16,32,48,128]] + ['tests/core.test.mjs','tests/background.test.mjs','tests/browser-check.mjs','tests/network-check.mjs','tests/package_extension.py','TESTING.md'] + (['docs/dashboard.png'] if (root/'docs/dashboard.png').is_file() else [])
missing = [f for f in files if not (root/f).is_file()]
if missing:
    print('Icons generated. Not packaging yet; missing:', missing)
else:
    dest=root.parent/'github-lens-v1.0.0.zip'
    with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
        for file in files:
            z.write(root/file, 'github-lens/'+file)
    with zipfile.ZipFile(dest) as z:
        assert z.testzip() is None
        assert len(z.namelist())==len(files)
    print('Validated manifest:',manifest['name'],manifest['version'])
    print('Package:',dest,'Bytes:',dest.stat().st_size,'Files:',len(files))
