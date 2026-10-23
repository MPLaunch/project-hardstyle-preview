"""Prepare the real Project Hardstyle event history for loading into the site.

Reads a curated seed list (seed-events.json, every row sourced from the research
in the prospect folder), shrinks each poster to a web-friendly JPEG (long edge
2000px), measures it and picks its accent colour with the SAME rules the admin
uses in the browser (assets/js/common.js palette + vivid). Writes _seed/out.json
and the prepared images into _seed/img/ for seed.cjs to upload.

    python prepare_seed.py <seed-events.json> <out-dir>
"""
import colorsys, json, os, sys
from PIL import Image, ImageOps


def palette(img):
    small = img.convert("RGB").resize((72, 90), Image.BILINEAR)
    bins = [[0.0, 0.0, 0.0, 0.0] for _ in range(36)]
    for r, g, b in small.getdata():
        rf, gf, bf = r / 255, g / 255, b / 255
        mx, mn = max(rf, gf, bf), min(rf, gf, bf)
        d = mx - mn
        s = 0 if mx == 0 else d / mx
        v = mx
        if s < 0.42 or v < 0.42:
            continue
        if d == 0:
            h = 0
        elif mx == rf:
            h = ((gf - bf) / d) % 6
        elif mx == gf:
            h = (bf - rf) / d + 2
        else:
            h = (rf - gf) / d + 4
        h = (h * 60 + 360) % 360
        wt = s * v * v
        bn = bins[int(h // 10) % 36]
        bn[0] += wt; bn[1] += r * wt; bn[2] += g * wt; bn[3] += b * wt
    ranked = sorted([(i, b) for i, b in enumerate(bins) if b[0] > 0.5], key=lambda x: -x[1][0])
    picked = []
    for i, b in ranked:
        if len(picked) >= 5:
            break
        if all(min(abs(p - i), 36 - abs(p - i)) >= 3 for p, _ in picked):
            picked.append((i, b))
    return [vivid(b[1] / b[0], b[2] / b[0], b[3] / b[0]) for _, b in picked]


def vivid(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    s = max(s, 0.82)
    l = min(max(l, 0.52), 0.64)
    rr, gg, bb = colorsys.hls_to_rgb(h, l, s)
    return "#%02x%02x%02x" % (round(rr * 255), round(gg * 255), round(bb * 255))


def main(seed_path, out_dir):
    rows = json.load(open(seed_path, encoding="utf-8"))
    img_dir = os.path.join(out_dir, "img")
    os.makedirs(img_dir, exist_ok=True)
    out = []
    for row in rows:
        r = dict(row)
        src = r.pop("poster_file", None)
        if src:
            im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
            scale = min(1.0, 2000 / max(im.size))
            if scale < 1:
                im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
            name = r["id"] + ".jpg"
            im.save(os.path.join(img_dir, name), "JPEG", quality=86, optimize=True, progressive=True)
            pal = palette(im)
            r["poster_local"] = os.path.join(img_dir, name)
            r["posterW"], r["posterH"] = im.size
            r["palette"] = pal
            if not r.get("accent"):
                r["accent"] = pal[0] if pal else None
        out.append(r)
        print(f'{r["date"]}  {r["title"][:40]:40}  {r.get("posterW")}x{r.get("posterH")}  accent {r.get("accent")}  {r.get("palette")}')
    json.dump(out, open(os.path.join(out_dir, "out.json"), "w", encoding="utf-8"), indent=1)
    print(f"{len(out)} events prepared -> {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
