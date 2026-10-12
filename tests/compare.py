import sys, os, json
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]
for f in sorted(os.listdir(a)):
    if f.endswith('.png'):
        A = Image.open(os.path.join(a, f)).convert('RGB'); B = Image.open(os.path.join(b, f)).convert('RGB')
        if A.size != B.size: print(f, 'SIZE DIFF', A.size, B.size); continue
        d = ImageChops.difference(A, B); bbox = d.getbbox()
        n = sum(1 for px in d.getdata() if px != (0, 0, 0)) if bbox else 0
        print(f, 'identical' if not bbox else f'{n} px differ in {bbox}')
    elif f.endswith('.json'):
        ja, jb = json.load(open(os.path.join(a, f), encoding='utf-8')), json.load(open(os.path.join(b, f), encoding='utf-8'))
        diffs = [k for k in ja if ja[k] != jb.get(k)]
        if diffs: print(f, 'DOM differs:', diffs)
