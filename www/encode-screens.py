#!/usr/bin/env python3
"""Crop and encode one raw app capture to WebP with Pillow.

The fallback half of `encode-screens.sh`, for a machine without ImageMagick
and cwebp. That script still owns the plan — which capture becomes which asset,
and every crop rectangle — and calls this once per asset:

    encode-screens.py SRC.png DST.webp [WxH+X+Y]

Same geometry syntax as `magick -crop`, and lossy WebP at q90 with the slowest,
best method (6). One difference, and it is why cwebp stays the first choice:
Pillow exposes neither `-sharp_yuv` nor `-preset text`, so the saturated amber
and green 10px type is chroma-subsampled the plain way and edges soften a
little more than they do from cwebp. Check a crop at 2x before publishing.

Unlike `magick -crop`, a rectangle that runs off the capture is an error rather
than a silently smaller image: every asset is published at the size its
rectangle says, and the pages hard-code those sizes.
"""

import re
import sys

from PIL import Image

QUALITY = 90
METHOD = 6


def main(argv):
    if len(argv) not in (3, 4):
        sys.exit(f"usage: {argv[0]} SRC.png DST.webp [WxH+X+Y]")
    src, dst = argv[1], argv[2]
    im = Image.open(src).convert("RGB")
    if len(argv) == 4:
        m = re.fullmatch(r"(\d+)x(\d+)\+(\d+)\+(\d+)", argv[3])
        if not m:
            sys.exit(f"{argv[3]}: not a WxH+X+Y rectangle")
        w, h, x, y = map(int, m.groups())
        if x + w > im.width or y + h > im.height:
            sys.exit(f"{argv[3]} runs off {src} ({im.width}x{im.height})")
        im = im.crop((x, y, x + w, y + h))
    im.save(dst, "WEBP", quality=QUALITY, method=METHOD)


if __name__ == "__main__":
    main(sys.argv)
