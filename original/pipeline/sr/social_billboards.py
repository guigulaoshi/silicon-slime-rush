"""Build the language-specific owner-channel billboard faces from the sources.

Ordinary QR codes are regenerated rather than baked out of phone screenshots. This keeps them
crisp at 1024x512 and leaves no accidental UI, account name, or portrait in the shipped files. Each
face carries only a large call to action, a platform mark (self-drawn, or the official one for Bilibili and
Xiaohongshu), and the code. WeChat
Channels has no public profile URL, so its platform code is cropped from the supplied share card
and the reserved artwork disc in its centre is cleared.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode
from qrcode.constants import ERROR_CORRECT_M

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "pipeline" / "assets" / "social-sources"   # the owner's own share cards; not in the repository
OUTPUT = ROOT / "game" / "public" / "billboards"
SIZE = (1024, 512)
# Scanned off a screen from the road beside the board, so the code is as large as the
# right-hand column allows and uses error level M -- nothing ever covers a billboard, and H only
# buys more, smaller modules (37 vs 29 across for a YouTube address).
QR_SIZE = 424
QR_BOX = (568, 44, 568 + QR_SIZE, 44 + QR_SIZE)
# One platform mark on the left and "Follow me on <platform>" beside it; the platform's
# name is written once, inside that call to action, never again as a separate wordmark.
LOGO_BOX = (40, 176, 200, 336)
HEADLINE_BOX = (220, 96, 568, 416)
WORD_GAP = .28   # of the font size; the bundled face's own space is too wide for a 348 px column
WECHAT_COVER = 212   # half the code, like the 204 it replaced at 408
MANIFEST = OUTPUT / "manifest.json"
FONT = ROOT / "pipeline" / "assets" / "fonts" / "NotoSansSC-Billboards.ttf"
LOGOS = ROOT / "pipeline" / "assets" / "logos"
BILIBILI_BLUE = "#00aeec"


def _font(size, weight=400):
    font = ImageFont.truetype(str(FONT), size)
    font.set_variation_by_axes([weight])
    return font


def _fit_font(draw, text, max_width, start, weight=400):
    size = start
    while size > 14:
        font = _font(size, weight)
        if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
            return font
        size -= 2
    return _font(size, weight)


def _centred_text(draw, box, text, font, fill):
    bounds = draw.textbbox((0, 0), text, font=font)
    w, h = bounds[2] - bounds[0], bounds[3] - bounds[1]
    x = box[0] + (box[2] - box[0] - w) / 2 - bounds[0]
    y = box[1] + (box[3] - box[1] - h) / 2 - bounds[1]
    draw.text((x, y), text, font=font, fill=fill)


def _left_centred_text(draw, box, text, font, fill):
    """Vertically centre text in a box while preserving a crisp left edge."""
    bounds = draw.textbbox((0, 0), text, font=font)
    h = bounds[3] - bounds[1]
    y = box[1] + (box[3] - box[1] - h) / 2 - bounds[1]
    draw.text((box[0], y), text, font=font, fill=fill)


def _words_width(draw, words, font):
    return (sum(draw.textbbox((0, 0), word, font=font)[2] for word in words)
            + WORD_GAP * font.size * (len(words) - 1))


def _fit_words(draw, text, max_width, start, weight=400):
    words = text.split()
    for size in range(start, 17, -2):
        font = _font(size, weight)
        if _words_width(draw, words, font) <= max_width:
            return font
    return _font(18, weight)


def _left_centred_words(draw, box, text, font, fill):
    """Like _left_centred_text, with a tighter word gap than the font's own space."""
    bounds = draw.textbbox((0, 0), text, font=font)
    y = box[1] + (box[3] - box[1] - (bounds[3] - bounds[1])) / 2 - bounds[1]
    x = box[0]
    for word in text.split():
        draw.text((x, y), word, font=font, fill=fill)
        x += draw.textbbox((0, 0), word, font=font)[2] + WORD_GAP * font.size


def _music_note(draw, x, y, size):
    """The cyan/red offset note shared by TikTok and Douyin, drawn without a bitmap asset."""
    for dx, dy, color in ((-5, 3, "#25f4ee"), (5, -3, "#fe2c55"), (0, 0, "#ffffff")):
        width = max(5, size // 12)
        draw.line((x + size * .56 + dx, y + size * .18 + dy,
                   x + size * .56 + dx, y + size * .70 + dy), fill=color, width=width)
        draw.line((x + size * .56 + dx, y + size * .20 + dy,
                   x + size * .82 + dx, y + size * .35 + dy), fill=color, width=width)
        draw.ellipse((x + size * .22 + dx, y + size * .58 + dy,
                      x + size * .62 + dx, y + size * .90 + dy), fill=color)


def _tinted(path, color):
    """A single-colour mark from the alpha channel of a black-on-transparent raster."""
    alpha = Image.open(path).convert("RGBA").getchannel("A")
    mark = Image.new("RGBA", alpha.size, color)
    mark.putalpha(alpha)
    return mark


def _paste_mark(image, mark, box, scale):
    """Centre a square mark in the logo box at `scale` of its side, alpha-composited."""
    side = round(min(box[2] - box[0], box[3] - box[1]) * scale)
    mark = mark.resize((side, side), Image.Resampling.LANCZOS)
    x = box[0] + (box[2] - box[0] - side) // 2
    y = box[1] + (box[3] - box[1] - side) // 2
    image.paste(mark, (x, y), mark)


def _draw_logo(image, platform, box, accent, language):
    """Draw each platform's mark: geometry, or the official bitmap where the owner asked for it."""
    draw = ImageDraw.Draw(image)
    x, y, right, bottom = box
    size = min(right - x, bottom - y)
    if platform == "x":
        # An app-icon tile with the mark built from strokes: a font "X" here read as the platform's
        # name written a second time beside "Follow me on X".
        draw.rounded_rectangle(box, radius=int(size * .22), fill="#000000", outline="#3a4452", width=4)
        pad = size * .24
        draw.polygon(((x + pad, y + pad), (x + pad + size * .15, y + pad),
                      (right - pad, bottom - pad), (right - pad - size * .15, bottom - pad)), fill="#ffffff")
        draw.line((right - pad, y + pad, x + pad, bottom - pad), fill="#ffffff", width=max(4, int(size * .045)))
    elif platform == "youtube":
        draw.rounded_rectangle((x, y + size * .16, right, bottom - size * .16),
                               radius=int(size * .20), fill="#ff0033")
        draw.polygon(((x + size * .42, y + size * .34), (x + size * .42, y + size * .66),
                      (x + size * .70, y + size * .50)), fill="#ffffff")
    elif platform in {"tiktok", "douyin"}:
        _music_note(draw, x, y, size)
    elif platform == "bilibili":
        # The official marks
        # replace the hand-drawn ones; provenance is in ASSETS.md. The TV glyph ships as an alpha
        # mask, set in the platform's blue on a white app tile.
        draw.rounded_rectangle(box, radius=int(size * .22), fill="#ffffff")
        _paste_mark(image, _tinted(LOGOS / "bilibili.png", BILIBILI_BLUE), box, .74)
    elif platform == "xiaohongshu":
        # The official app icon is its wordmark on red; it is a bitmap, not text, so the call to
        # action beside it is still the only place the name is written as text.
        _paste_mark(image, Image.open(LOGOS / "xiaohongshu.png").convert("RGBA"), box, 1)
    else:  # WeChat Channels
        stroke = max(5, int(size * .055))
        draw.ellipse(box, fill="#fa9d3b")
        draw.arc((x + size * .16, y + size * .22, x + size * .58, y + size * .82),
                 225, 495, fill="#ffffff", width=stroke)
        draw.arc((x + size * .42, y + size * .18, x + size * .84, y + size * .78),
                 45, 315, fill="#ffffff", width=stroke)


def load_channels():
    """Read the seven social slots from the runtime's content owner."""
    manifest = json.loads(MANIFEST.read_text())
    return [face for face in manifest["faces"] if face["kind"] == "social"]


def _standard_qr(target, size=QR_SIZE):
    code = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=10, border=4)
    code.add_data(target)
    code.make(fit=True)
    return code.make_image(fill_color="#10151c", back_color="#ffffff").convert("RGB").resize(
        (size, size), Image.Resampling.NEAREST)


def _wechat_source_code(source_name, size=QR_SIZE):
    source = Image.open(SOURCE / source_name).convert("RGB")
    return ImageOps.fit(source.crop((145, 535, 715, 1105)), (size, size), Image.Resampling.LANCZOS)


def _wechat_cover_size(size):
    return round(WECHAT_COVER * size / QR_SIZE)


def _wechat_code(source_name, size=QR_SIZE):
    code = _wechat_source_code(source_name, size)
    # The original share code reserves its centre disc for artwork, so clearing the whole portrait
    # does not erase any of the surrounding code marks.
    cover = _wechat_cover_size(size)
    ImageDraw.Draw(code).ellipse(
        ((size - cover) // 2, (size - cover) // 2, (size + cover) // 2, (size + cover) // 2),
        fill="#ffffff",
    )
    return code


def headline_lines(content, language):
    """Split the manifest's call to action into its lead-in and the platform name it ends with."""
    headline, brand = content["headline"], content["brand"]
    if not headline.endswith(brand):
        raise ValueError(f"headline {headline!r} does not end with its platform {brand!r}")
    lead = headline[:-len(brand)].strip()
    return (lead.upper(), brand.upper()) if language == "en" else (lead, brand)


def image_language(name):
    """The language a finished board is set in, from its file name: `social-x-en.png` is English."""
    stem = name.removesuffix(".png")
    if stem.endswith("-zh"):
        return "zh"
    if stem.endswith("-en"):
        return "en"
    raise ValueError(f"social board {name!r} does not say its language")


def render(channel, language):
    content = channel[language]
    bg = Image.new("RGB", SIZE, "#10151c")
    draw = ImageDraw.Draw(bg)
    accent = content["color"]
    draw.rounded_rectangle((16, 16, 1008, 496), radius=28, outline=accent, width=7)
    _draw_logo(bg, content["platform"], LOGO_BOX, accent, language)

    lead, brand = headline_lines(content, language)
    width = HEADLINE_BOX[2] - HEADLINE_BOX[0]
    middle = (HEADLINE_BOX[1] + HEADLINE_BOX[3]) // 2
    _left_centred_words(draw, (HEADLINE_BOX[0], middle - 92, HEADLINE_BOX[2], middle - 4), lead,
                        _fit_words(draw, lead, width, 58, 800), "#ffffff")
    _left_centred_text(draw, (HEADLINE_BOX[0], middle + 4, HEADLINE_BOX[2], middle + 104), brand,
                       _fit_font(draw, brand, width, 84, 800), accent)

    code = (_wechat_code(content["sourceCode"]) if content.get("sourceCode") else
            _standard_qr(content["target"]))
    bg.paste(code, QR_BOX[:2])
    return bg


def build_all():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    expected = {
        channel[language]["image"].removeprefix("billboards/")
        for channel in load_channels() for language in ("zh", "en")
    }
    for old in OUTPUT.glob("social-*.png"):
        if old.name not in expected:
            old.unlink()
    written = set()
    for channel in load_channels():
        for language in ("zh", "en"):
            path = OUTPUT / channel[language]["image"].removeprefix("billboards/")
            if path in written:
                continue
            # Every social slot now carries one platform in both languages, so the same
            # finished board is reached through both copies. It is set in the platform's own language
            # -- the one its file is named for -- not in whichever copy happened to be read first,
            # or an English board would come out in the Chinese layout.
            native = image_language(path.name)
            render({native: channel[language]}, native).save(path, "PNG")
            written.add(path)


if __name__ == "__main__":
    build_all()
