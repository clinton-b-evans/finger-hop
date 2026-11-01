"""Authoring tool: renders every character pose wearing outfits, using the same
anchor data the game reads (assets/characters.json), so anchors can be tuned by eye.
Run: python3 tools/outfit_preview.py out.png [outfit ...]"""
import json, sys
from PIL import Image, ImageDraw

D = json.load(open('assets/characters.json'))
H = 300  # drawn character height

def load(n): return Image.open(f'assets/{n}.png').convert('RGBA')

def paste(canvas, img, w, anchor, at):
    s = w / img.width
    im = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))))
    x = round(at[0] - anchor[0] * im.width); y = round(at[1] - anchor[1] * im.height)
    canvas.alpha_composite(im, (x, y)) if x >= 0 and y >= 0 else canvas.paste(im, (x, y), im)

def draw(canvas, char, sprite, outfits, ox, oy):
    a = D['sprites'][sprite]; img = load(sprite); s = H / img.height
    feet = (ox, oy)
    top_left = (feet[0] - a['feet'][0] * img.width * s, feet[1] - a['feet'][1] * img.height * s)
    pt = lambda k: (top_left[0] + a[k][0] * img.width * s, top_left[1] + a[k][1] * img.height * s)
    by_slot = {D['outfits'][o]['slot']: o for o in outfits}
    hs = D['characters'][char].get('headScale', 1)
    def item(slot):
        o = by_slot.get(slot)
        if not o: return
        spec = D['outfits'][o]; target = pt('neck' if slot == 'back' else slot)
        off = spec.get('offset', [0, 0]); target = (target[0] + off[0] * H, target[1] + off[1] * H)
        paste(canvas, load(o), spec['width'] * H * (hs if slot in ('head', 'eyes') else 1), spec['anchor'], target)
    item('back')
    paste(canvas, img, img.width * s, (0, 0), top_left)
    for sl in ('neck', 'eyes', 'head'): item(sl)

out = sys.argv[1]
sets = [sys.argv[2:]] if len(sys.argv) > 2 else [['hat_party', 'wear_sunglasses'], ['hat_crown', 'wear_scarf', 'wear_cape'],
                                                  ['hat_pirate', 'wear_mask'], ['hat_wizard']]
sprites = [(c, s) for c, v in D['characters'].items() for s in dict.fromkeys(v['poses'].values())]
cw, ch = 260, H + 120
img = Image.new('RGBA', (cw * len(sprites), ch * len(sets)), (220, 240, 255, 255))
for r, outfits in enumerate(sets):
    for i, (c, s) in enumerate(sprites):
        draw(img, c, s, outfits, i * cw + cw // 2, r * ch + ch - 15)
img.convert('RGB').save(out)
