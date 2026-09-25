import json
import re

import numpy as np
import pytest
from PIL import Image, ImageDraw
import zxingcpp

from sr.social_billboards import (BILIBILI_BLUE, FONT, HEADLINE_BOX, LOGO_BOX, LOGOS, _fit_words, _words_width, MANIFEST, OUTPUT, QR_BOX,
                                   SIZE, WECHAT_COVER, _fit_font, _font, _wechat_code,
                                   _wechat_cover_size, _wechat_source_code, headline_lines, image_language,
                                   load_channels, render)

# Rendering a face again needs the owner's own WeChat share card, which is not in the repository;
# the faces it made are, and the tests that read those still run.
from sr.social_billboards import SOURCE
needs_share_card = pytest.mark.skipif(not (SOURCE / "07-wechat-channels-qr.png").exists(),
                                      reason="the owner's share card is not in the repository")

ALL_PLATFORMS = {"x", "youtube", "tiktok", "bilibili", "xiaohongshu", "douyin", "wechat"}


def native(channel):
    """The one copy a social slot carries and the language it is set in."""
    content = channel["zh"]
    return content, image_language(content["image"].removeprefix("billboards/"))


@needs_share_card
def test_every_platform_is_on_exactly_one_slot_whatever_the_language():
    """
    Before it, the Chinese interface rotated four platforms and the English one three, so each language
    showed half of them and repeated some."""
    channels = load_channels()
    assert len(channels) == 7
    for channel in channels:
        assert channel["zh"] == channel["en"], channel["zh"]["platform"]
    assert sorted(c["zh"]["platform"] for c in channels) == sorted(ALL_PLATFORMS)
    for channel in channels:
        content, language = native(channel)
        face = render({language: content}, language)
        assert face.size == SIZE
        assert face.mode == "RGB"


def test_every_face_is_written_in_its_own_platform_language_and_keeps_its_recorded_target():
    for channel in load_channels():
        content, language = native(channel)
        chinese = bool(re.search(r"[\u3400-\u9fff]", content["headline"]))
        assert chinese == (language == "zh"), (content["platform"], language)
        if content["platform"] == "wechat":
            assert content["target"] == "weixin-channel:硅谷老实人"
        else:
            assert content["target"].startswith(("http://", "https://"))


def test_the_bundled_font_contains_every_requested_chinese_glyph():
    assert FONT.is_file()
    font = _font(64, 800)
    missing = font.getmask("\U0010ffff")
    missing_signature = (missing.size, bytes(missing))
    requested = "关注我的抖音小红书哔哩微信视频号"
    for char in requested:
        mask = font.getmask(char)
        assert mask.getbbox() is not None, char
        assert (mask.size, bytes(mask)) != missing_signature, char


def test_every_follow_message_fits_its_two_distance_readable_lines():
    draw = ImageDraw.Draw(Image.new("RGB", SIZE))
    width = HEADLINE_BOX[2] - HEADLINE_BOX[0]
    for channel in load_channels():
        content, language = native(channel)
        lead, brand = headline_lines(content, language)
        lead_font = _fit_words(draw, lead, width, 58, 800)
        brand_font = _fit_font(draw, brand, width, 84, 800)
        assert _words_width(draw, lead.split(), lead_font) <= width
        assert draw.textbbox((0, 0), brand, font=brand_font)[2] <= width
        assert min(lead_font.size, brand_font.size) >= 42, (content["platform"], language)


def test_logo_headline_and_qr_have_non_overlapping_visual_zones():
    def overlaps(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]

    assert LOGO_BOX[2] - LOGO_BOX[0] == 160
    assert not overlaps(LOGO_BOX, HEADLINE_BOX)
    assert not overlaps(HEADLINE_BOX, QR_BOX)
    assert QR_BOX[2] <= SIZE[0] - 32


@needs_share_card
def test_the_platform_name_is_written_once_beside_its_mark(monkeypatch):
    """No separate wordmark over the call to action, and no text drawn into a logo.
    Put Xiaohongshu's official icon -- its wordmark, as a bitmap -- in the logo box at the
    owner's request; that is the platform's mark, not the name written a second time as text."""
    for channel in load_channels():
        content, language = native(channel)
        texts = []
        original = ImageDraw.ImageDraw.text
        monkeypatch.setattr(ImageDraw.ImageDraw, "text",
                            lambda self, xy, text, *a, **k: (texts.append((xy[0], text)), original(self, xy, text, *a, **k))[1])
        render({language: content}, language)
        monkeypatch.undo()
        brand = content["brand"].upper() if language == "en" else content["brand"]
        column = [text for x, text in texts if x >= HEADLINE_BOX[0]]
        assert [text for text in column if brand in text] == [brand], (content["platform"], language, texts)
        # The mark is drawn, never lettered: no text of any kind inside the logo box.
        assert all(x >= HEADLINE_BOX[0] for x, text in texts), (content["platform"], language, texts)


def test_generated_faces_are_shipped_next_to_the_manifest():
    for channel in load_channels():
        for language in ("zh", "en"):
            path = OUTPUT / channel[language]["image"].removeprefix("billboards/")
            assert path.is_file(), path


@needs_share_card
def test_each_shipped_board_contains_the_pixels_rendered_from_its_copy():
    """A filename suffix is not evidence: swapping two finished PNGs must make the test fail."""
    for channel in load_channels():
        content, language = native(channel)
        path = OUTPUT / content["image"].removeprefix("billboards/")
        shipped = np.asarray(Image.open(path).convert("RGB"))
        expected = np.asarray(render({language: content}, language))
        assert np.array_equal(shipped, expected), (content["platform"], language)


def test_only_the_seven_social_images_are_shipped():
    expected = {
        channel[language]["image"].removeprefix("billboards/")
        for channel in load_channels() for language in ("zh", "en")
    }
    assert {path.name for path in OUTPUT.glob("social-*.png")} == expected


def test_six_standard_codes_decode_from_the_shipped_face_at_reduced_resolution():
    unique = {}
    for channel in load_channels():
        for language in ("zh", "en"):
            content = channel[language]
            unique[content["image"]] = content
    for content in unique.values():
        if content["platform"] == "wechat":
            continue
        path = OUTPUT / content["image"].removeprefix("billboards/")
        code = Image.open(path).convert("RGB").crop(QR_BOX)
        samples = {
            "full": code,
            "160px": code.resize((160, 160), Image.Resampling.LANCZOS),
            "angled": code.resize((200, 200), Image.Resampling.LANCZOS).rotate(
                8, expand=True, fillcolor="#ffffff"),
        }
        for condition, sample in samples.items():
            result = zxingcpp.read_barcode(np.asarray(sample))
            assert result is not None, (content["platform"], condition)
            assert result.text == content["target"]

        # Exercise the code after the whole billboard texture has been minified to a realistic
        # distant view, then squeeze the far end horizontally to approximate perspective.
        distant = Image.open(path).convert("RGB").resize((320, 160), Image.Resampling.LANCZOS)
        scaled_box = (
            round(QR_BOX[0] * 320 / SIZE[0]), round(QR_BOX[1] * 160 / SIZE[1]),
            round(QR_BOX[2] * 320 / SIZE[0]), round(QR_BOX[3] * 160 / SIZE[1]),
        )
        perspective_code = distant.crop(scaled_box).resize((96, 128), Image.Resampling.LANCZOS)
        result = zxingcpp.read_barcode(np.asarray(perspective_code))
        assert result is not None, (content["platform"], "320px-distant-perspective")
        assert result.text == content["target"]


@needs_share_card
def test_wechat_platform_code_survives_losslessly_outside_its_cleared_avatar_disc():
    content = next(c["zh"] for c in load_channels() if c["zh"]["platform"] == "wechat")
    source_name = content["sourceCode"]
    path = OUTPUT / content["image"].removeprefix("billboards/")
    shipped = np.asarray(Image.open(path).convert("RGB").crop(QR_BOX))
    expected = np.asarray(_wechat_code(source_name))
    original = np.asarray(_wechat_source_code(source_name))
    outside = Image.new("1", (QR_BOX[2] - QR_BOX[0], QR_BOX[3] - QR_BOX[1]), 1)
    side = outside.width
    ImageDraw.Draw(outside).ellipse(
        ((side - WECHAT_COVER) // 2, (side - WECHAT_COVER) // 2,
         (side + WECHAT_COVER) // 2, (side + WECHAT_COVER) // 2), fill=0,
    )
    mask = np.asarray(outside, dtype=bool)
    assert np.array_equal(shipped[mask], original[mask])
    assert np.array_equal(shipped, expected)
    assert np.all(shipped[~mask] == 255), "the supplied portrait survived"


def test_wechat_avatar_cover_scales_with_the_code_instead_of_erasing_more_modules():
    assert _wechat_cover_size(QR_BOX[2] - QR_BOX[0]) == WECHAT_COVER
    assert _wechat_cover_size(348) == 174
    assert _wechat_cover_size(204) == 102


def test_manifest_is_the_only_owner_of_render_copy():
    data = json.loads(MANIFEST.read_text())
    social = [face for face in data["faces"] if face["kind"] == "social"]
    assert len(social) == 7
    assert all("render" not in face for face in social)


@needs_share_card
def test_bilibili_and_xiaohongshu_carry_their_official_marks():
    """The downloaded marks, not
    the hand-drawn stand-ins, and only on those two boards."""
    faces = {c["zh"]["platform"]: native(c) for c in load_channels()}

    content, language = faces["xiaohongshu"]
    logo = np.asarray(render({language: content}, language).crop(LOGO_BOX)).astype(int)
    side = LOGO_BOX[2] - LOGO_BOX[0]
    official = Image.open(LOGOS / "xiaohongshu.png").convert("RGBA").resize((side, side), Image.Resampling.LANCZOS)
    flat = Image.new("RGB", official.size, "#10151c")
    flat.paste(official, (0, 0), official)
    assert np.abs(logo - np.asarray(flat).astype(int)).max() <= 1

    content, language = faces["bilibili"]
    logo = np.asarray(render({language: content}, language).crop(LOGO_BOX)).reshape(-1, 3)
    blue = np.array([int(BILIBILI_BLUE[i:i + 2], 16) for i in (1, 3, 5)])
    assert (np.abs(logo - blue).max(axis=1) <= 2).sum() > side * side * .08   # the TV glyph
    assert (logo.min(axis=1) >= 250).sum() > side * side * .30                 # its white tile

    for platform in ALL_PLATFORMS - {"xiaohongshu", "bilibili"}:
        content, language = faces[platform]
        logo = np.asarray(render({language: content}, language).crop(LOGO_BOX)).reshape(-1, 3)
        assert not (np.abs(logo - blue).max(axis=1) <= 2).any(), platform
