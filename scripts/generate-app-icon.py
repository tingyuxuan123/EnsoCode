#!/usr/bin/env python3
"""Legacy renderer retained for reference; generate-app-icon.mjs is authoritative.

The old ensō geometry below is not used. Direct execution delegates to Node,
which generates Collabra PNG / ICO / ICNS / tray / PWA assets on all platforms.
"""

from __future__ import annotations

import io
import math
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

# Delegate before importing Pillow, including on machines without Python imaging.
if __name__ == "__main__":
    subprocess.run(["node", str(Path(__file__).with_suffix(".mjs"))], check=True)
    raise SystemExit(0)

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"

BG = (0xFF, 0xFF, 0xFF)
FG = (0x46, 0x49, 0x52)
BG_HEX = "#FFFFFF"
FG_HEX = "#464952"

RADIUS = 261
STROKE = 62
GAP_DEG = 27.5
GAP_CENTER = 47.5
CANVAS = 1024
SQUIRCLE_INSET = 0.098
SQUIRCLE_N = 6.0
# origin/dev Windows card radius (EnsoAI-aligned rounded rect, not squircle).
WIN_CORNER = 0.26
ICO_SIZES = (16, 32, 48, 64, 128, 256)
# EnsoAI: 16/32 keep white RGB + empty AND mask; 48–128 use real AND mask.
ICO_SMALL_SIZES = {16, 32}
SHADOW_BLUR = 20
SHADOW_OFFSET_Y = 12
SHADOW_OPACITY = 0.32
PHONE_ICONS = ROOT / "packages/phone/public/icons"
MASKABLE_SAFE = 0.8
PWA_BG = BG
PWA_FG = FG


def _params(size: int) -> tuple[float, float, float]:
    scale = size / CANVAS
    return STROKE * scale, RADIUS * scale, GAP_DEG


def render(
    size: int,
    bg: tuple[int, int, int] = BG,
    fg: tuple[int, int, int] = FG,
) -> Image.Image:
    stroke, radius, gap = _params(size)
    ss = 8 if size <= 64 else 4
    S = size * ss
    im = Image.new("RGB", (S, S), bg)
    d = ImageDraw.Draw(im)
    cx = cy = (S - 1) / 2
    r = radius * ss
    stroke_s = max(ss, stroke * ss)
    ro = r + stroke_s / 2
    ri = max(0.0, r - stroke_s / 2)
    start = GAP_CENTER + gap / 2
    end = GAP_CENTER - gap / 2
    d.ellipse((cx - ro, cy - ro, cx + ro, cy + ro), fill=fg)
    d.ellipse((cx - ri, cy - ri, cx + ri, cy + ri), fill=bg)
    pad = stroke_s
    d.pieslice(
        (cx - ro - pad, cy - ro - pad, cx + ro + pad, cy + ro + pad),
        start=end,
        end=start,
        fill=bg,
    )
    cap_r = stroke_s / 2

    def pt(ang: float) -> tuple[float, float]:
        a = math.radians(ang)
        return cx + r * math.cos(a), cy + r * math.sin(a)

    for ang in (start, end):
        x, y = pt(ang)
        d.ellipse((x - cap_r, y - cap_r, x + cap_r, y + cap_r), fill=fg)
    return im.resize((size, size), Image.Resampling.LANCZOS)


def squircle_mask(size: int) -> Image.Image:
    ss = 4
    S = size * ss
    a = (S * (1 - 2 * SQUIRCLE_INSET)) / 2
    cx = cy = S / 2
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    n = SQUIRCLE_N
    for y in range(S):
        yn = abs((y + 0.5 - cy) / a)
        if yn >= 1:
            continue
        span = (1 - yn**n) ** (1 / n)
        d.line((cx - span * a, y, cx + span * a, y), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def apply_squircle(im: Image.Image) -> Image.Image:
    out = im.convert("RGBA")
    out.putalpha(squircle_mask(im.size[0]))
    return out


def apply_mac_shadow(im: Image.Image) -> Image.Image:
    alpha = im.getchannel("A")
    shade = alpha.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    shade = shade.point(lambda p: min(255, round(p * SHADOW_OPACITY)))
    shifted = Image.new("L", im.size, 0)
    shifted.paste(shade, (0, SHADOW_OFFSET_Y))
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    layer.putalpha(shifted)
    return Image.alpha_composite(layer, im.convert("RGBA"))


def with_windows_corners(im: Image.Image) -> Image.Image:
    size = im.size[0]
    radius = max(1, round(size * WIN_CORNER))
    ss = 8 if size <= 64 else 4
    S = size * ss
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=radius * ss, fill=255)
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def associated_alpha(im: Image.Image) -> Image.Image:
    """Match EnsoAI: fully transparent pixels are (0,0,0,0).

    White RGB under alpha is painted as a square when Windows ignores the
    alpha channel (Explorer / taskbar). Black RGB under alpha still reads as
    a rounded white icon in that fallback path.
    """
    rgba = im.convert("RGBA")
    r, g, b, a = rgba.split()
    a = a.point(lambda p: 0 if p < 16 else p)
    black = Image.new("L", rgba.size, 0)
    return Image.merge(
        "RGBA",
        (
            Image.composite(r, black, a),
            Image.composite(g, black, a),
            Image.composite(b, black, a),
            a,
        ),
    )


def straight_white_alpha(im: Image.Image) -> Image.Image:
    """16/32 Explorer + taskbar frames: keep white RGB under alpha.

    EnsoAI does this on small BMP frames. Associated (0,0,0,0) is painted as a
    black tile in list / small icon views that ignore the alpha channel.
    Near-transparent edge dust is snapped to 0 so AND/alpha stay clean.
    """
    rgba = im.convert("RGBA")
    r, g, b, a = rgba.split()
    a = a.point(lambda p: 0 if p < 16 else p)
    white = Image.new("L", rgba.size, 255)
    return Image.merge(
        "RGBA",
        (
            Image.composite(r, white, a),
            Image.composite(g, white, a),
            Image.composite(b, white, a),
            a,
        ),
    )


def _png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _bmp32_ico(im: Image.Image, *, opaque_mask: bool = False) -> bytes:
    rgba = im.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    xor = bytearray()
    mask = bytearray()
    row_pad = ((width + 31) // 32) * 32
    for y in range(height - 1, -1, -1):
        bits: list[int] = []
        for x in range(width):
            r, g, b, a = pixels[x, y]
            xor += bytes((b, g, r, a))
            bits.append(0 if opaque_mask else (1 if a == 0 else 0))
        bits.extend([0] * (row_pad - width))
        for i in range(0, row_pad, 8):
            byte = 0
            for bit in bits[i : i + 8]:
                byte = (byte << 1) | bit
            mask.append(byte)
    # biSizeImage must be XOR-only (not XOR+mask). EnsoAI and the ICO DIB
    # convention use the XOR byte count here; including the AND mask makes
    # Windows Shell mis-parse the 32-bit alpha and paint a square plate.
    header = struct.pack(
        "<IiiHHIIiiII",
        40,
        width,
        height * 2,
        1,
        32,
        0,
        len(xor),
        0,
        0,
        0,
        0,
    )
    return header + xor + mask


def write_svg(path: Path) -> None:
    start = GAP_CENTER + GAP_DEG / 2
    end = GAP_CENTER - GAP_DEG / 2
    cx = cy = CANVAS / 2

    def pt(ang: float) -> tuple[float, float]:
        a = math.radians(ang)
        return cx + RADIUS * math.cos(a), cy + RADIUS * math.sin(a)

    x0, y0 = pt(start)
    x1, y1 = pt(end)
    path.write_text(
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">\n'
            f'  <rect width="{CANVAS}" height="{CANVAS}" fill="{BG_HEX}"/>\n'
            f'  <path d="M {x0:.2f} {y0:.2f} A {RADIUS} {RADIUS} 0 1 1 {x1:.2f} {y1:.2f}"'
            f' fill="none" stroke="{FG_HEX}" stroke-width="{STROKE}" stroke-linecap="round"/>\n'
            "</svg>\n"
        ),
        encoding="utf-8",
    )


def write_icns(master_sizes: dict[int, Image.Image], dest: Path) -> None:
    iconutil = shutil.which("iconutil")
    if not iconutil:
        raise SystemExit("iconutil not found")
    entries = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    with tempfile.TemporaryDirectory() as raw:
        iconset = Path(raw) / "icon.iconset"
        iconset.mkdir()
        for name, size in entries.items():
            master_sizes[size].save(iconset / name, format="PNG")
        subprocess.run([iconutil, "-c", "icns", "-o", str(dest), str(iconset)], check=True)


def write_ico(master_sizes: dict[int, Image.Image], dest: Path) -> None:
    """Write ICO in the same layout EnsoAI ships (and Windows Shell expects).

    - 256: PNG (Vista+ large icon)
    - 128/64/48: 32-bit BMP + real AND mask from alpha (GDI rounds corners)
    - 32/16: 32-bit BMP, white under alpha, empty AND mask (taskbar / list)

    Small frames as PNG look fine in Pillow but the taskbar often ignores their
    alpha and paints a square plate — that was the EnsoCode 直角 bug.
    """
    frames: list[bytes] = []
    sizes: list[int] = []
    for size in sorted(ICO_SIZES, reverse=True):
        small = size in ICO_SMALL_SIZES
        im = straight_white_alpha(master_sizes[size]) if small else associated_alpha(master_sizes[size])
        if size >= 256:
            frames.append(_png_bytes(im))
        else:
            frames.append(_bmp32_ico(im, opaque_mask=small))
        sizes.append(size)
    count = len(frames)
    data_offset = 6 + 16 * count
    directory = bytearray(struct.pack("<HHH", 0, 1, count))
    payload = bytearray()
    for size, frame in zip(sizes, frames, strict=True):
        dim = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(frame), data_offset + len(payload))
        payload += frame
    dest.write_bytes(bytes(directory) + bytes(payload))


def write_pwa_icons() -> None:
    rgb = render(1024, PWA_BG, PWA_FG)
    PHONE_ICONS.mkdir(parents=True, exist_ok=True)
    rgb.resize((180, 180), Image.Resampling.LANCZOS).save(PHONE_ICONS / "apple-touch-icon.png")
    rgb.resize((192, 192), Image.Resampling.LANCZOS).save(PHONE_ICONS / "icon-192.png")
    rgb.resize((512, 512), Image.Resampling.LANCZOS).save(PHONE_ICONS / "icon-512.png")
    inner = round(512 * MASKABLE_SAFE)
    canvas = Image.new("RGB", (512, 512), PWA_BG)
    glyph = rgb.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas.paste(glyph, ((512 - inner) // 2, (512 - inner) // 2))
    canvas.save(PHONE_ICONS / "icon-maskable-512.png")


def main() -> None:
    square = render(1024)
    master = apply_mac_shadow(apply_squircle(square))
    sizes = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
    images = {
        size: master if size == 1024 else master.resize((size, size), Image.Resampling.LANCZOS)
        for size in sizes
    }
    ico_images = {
        size: with_windows_corners(square.resize((size, size), Image.Resampling.LANCZOS))
        for size in ICO_SIZES
    }
    BUILD.mkdir(parents=True, exist_ok=True)
    write_svg(BUILD / "icon.svg")
    master.save(BUILD / "icon.png", format="PNG")
    icons_dir = BUILD / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 64, 128, 256, 512):
        images[size].save(icons_dir / f"{size}x{size}.png", format="PNG")
    if shutil.which("iconutil"):
        write_icns(images, BUILD / "icon.icns")
    else:
        print("skip icns (iconutil not found)")
    write_ico(ico_images, BUILD / "icon.ico")
    # Linux PNG uses straight alpha. Associated (0,0,0,0) fringe composites as
    # black hairlines in viewers that don't premultiply.
    win_png = straight_white_alpha(ico_images[256])
    win_png.save(BUILD / "icon-win.png", format="PNG")
    write_pwa_icons()
    if master.mode != "RGBA" or master.getpixel((0, 0))[3] != 0:
        raise SystemExit("master icon must be a transparent-corner squircle")
    if ico_images[32].getpixel((0, 0))[3] != 0:
        raise SystemExit("windows ico must keep transparent corners")
    ico_bytes = (BUILD / "icon.ico").read_bytes()
    first_off = int.from_bytes(ico_bytes[18:22], "little")
    if ico_bytes[first_off : first_off + 8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("ico must start with 256 png frame")
    count = int.from_bytes(ico_bytes[4:6], "little")
    ico_dims: list[tuple[int, bool]] = []
    for i in range(count):
        entry = 6 + i * 16
        dim = ico_bytes[entry] or 256
        off = int.from_bytes(ico_bytes[entry + 12 : entry + 16], "little")
        ico_dims.append((dim, ico_bytes[off : off + 8] == b"\x89PNG\r\n\x1a\n"))
    if 24 in {dim for dim, _ in ico_dims}:
        raise SystemExit("ico must not include 24px; taskbar would pick a square frame")
    # EnsoAI layout: only 256 is PNG; taskbar 32 must be BMP.
    if any(is_png for dim, is_png in ico_dims if dim < 256):
        raise SystemExit("frames under 256 must be BMP (PNG small frames → square taskbar)")
    if (32, False) not in ico_dims:
        raise SystemExit("32px taskbar frame must be BMP like EnsoAI")
    # 48+ BMP must carry a real AND mask so GDI rounds corners.
    def _mask_ones(size: int) -> int:
        for dim, is_png in ico_dims:
            if dim != size or is_png:
                continue
            for i in range(count):
                entry = 6 + i * 16
                d = ico_bytes[entry] or 256
                off = int.from_bytes(ico_bytes[entry + 12 : entry + 16], "little")
                sz = int.from_bytes(ico_bytes[entry + 8 : entry + 12], "little")
                if d != size:
                    continue
                payload = ico_bytes[off : off + sz]
                bi_size = int.from_bytes(payload[0:4], "little")
                height = abs(int.from_bytes(payload[8:12], "little", signed=True)) // 2
                width = int.from_bytes(payload[4:8], "little", signed=True)
                xor_size = width * height * 4
                row_pad = ((width + 31) // 32) * 32
                mask = payload[bi_size + xor_size :]
                return sum(bin(b).count("1") for b in mask[: (row_pad // 8) * height])
        return -1

    if _mask_ones(48) <= 0 or _mask_ones(128) <= 0:
        raise SystemExit("48/128 BMP frames must include a non-empty AND mask")
    if _mask_ones(32) != 0 or _mask_ones(16) != 0:
        raise SystemExit("16/32 BMP frames must use an empty AND mask like EnsoAI")
    # biSizeImage must be XOR-only (EnsoAI parity); XOR+mask → square taskbar.
    for dim, is_png in ico_dims:
        if is_png or dim < 16:
            continue
        for i in range(count):
            entry = 6 + i * 16
            d = ico_bytes[entry] or 256
            if d != dim:
                continue
            off = int.from_bytes(ico_bytes[entry + 12 : entry + 16], "little")
            payload = ico_bytes[off:]
            bi_size_image = int.from_bytes(payload[20:24], "little")
            xor_only = dim * dim * 4
            if bi_size_image != xor_only:
                raise SystemExit(
                    f"{dim}px biSizeImage must be XOR-only ({xor_only}), got {bi_size_image}"
                )
    with Image.open(BUILD / "icon.ico") as ico:
        small = ico.ico.getimage((16, 16)).convert("RGBA").getpixel((0, 0))
        taskbar = ico.ico.getimage((32, 32)).convert("RGBA")
        large = ico.ico.getimage((256, 256)).convert("RGBA")
    if small[:3] != (255, 255, 255) or small[3] != 0:
        raise SystemExit(f"16px corner must be white+transparent, got {small}")
    if taskbar.getpixel((0, 0))[:3] != (255, 255, 255) or taskbar.getpixel((0, 0))[3] != 0:
        raise SystemExit(f"32px corner must be white+transparent, got {taskbar.getpixel((0, 0))}")
    if taskbar.getpixel((16, 0))[3] < 200:
        raise SystemExit("32px must be a rounded card (top center opaque)")
    if large.getpixel((0, 0))[:3] != (0, 0, 0) or large.getpixel((0, 0))[3] != 0:
        raise SystemExit(f"256px corner must be (0,0,0,0), got {large.getpixel((0, 0))}")
    if large.getpixel((0, 0))[3] != 0 or large.getpixel((128, 0))[3] < 200:
        raise SystemExit("256px ico must be rounded, not a full square")
    win_corner = win_png.getpixel((0, 0))
    if win_corner != (255, 255, 255, 0) or win_png.getpixel((128, 0))[3] < 200:
        raise SystemExit(f"icon-win.png must be a rounded white RGBA card, got {win_corner}")
    fringe = next(
        (
            win_png.getpixel((x, y))
            for y in range(48)
            for x in range(48)
            if 16 < win_png.getpixel((x, y))[3] < 200
        ),
        None,
    )
    if fringe is None or min(fringe[:3]) < 240:
        raise SystemExit(f"icon-win.png fringe must stay white, got {fringe}")
    apple = Image.open(PHONE_ICONS / "apple-touch-icon.png")
    any512 = Image.open(PHONE_ICONS / "icon-512.png")
    if apple.mode != "RGB" or any512.mode != "RGB" or any512.getpixel((0, 0)) != PWA_BG:
        raise SystemExit("pwa icons must be opaque full-bleed RGB")
    print("wrote", BUILD / "icon.png")


if __name__ == "__main__":
    main()
