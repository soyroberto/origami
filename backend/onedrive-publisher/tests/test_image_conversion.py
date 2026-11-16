from io import BytesIO
from unittest.mock import MagicMock
import warnings

from PIL import Image, ImageCms, JpegImagePlugin
import pillow_heif
import pytest

from config import PublisherError
import image_conversion as conversion


def heic_bytes(image, **kwargs):
    """Only tiny synthetic images: no files or remote content."""
    # pillow-heif's orientation parser expects bytes, unlike Pillow's JPEG API.
    if isinstance(kwargs.get("exif"), Image.Exif):
        kwargs["exif"] = kwargs["exif"].tobytes()
    with BytesIO() as output:
        image.save(output, format="HEIF", quality=100, chroma="444", **kwargs)
        return output.getvalue()


def pattern():
    image = Image.new("RGB", (96, 64))
    image.paste((240, 20, 20), (0, 0, 48, 32))
    image.paste((20, 240, 20), (48, 0, 96, 32))
    image.paste((20, 20, 240), (0, 32, 48, 64))
    image.paste((230, 230, 20), (48, 32, 96, 64))
    return image


def assert_same_colors(actual, expected):
    assert actual.size == expected.size
    width, height = expected.size
    for x, y in ((width // 4, height // 4), (3 * width // 4, height // 4),
                 (width // 4, 3 * height // 4), (3 * width // 4, 3 * height // 4)):
        assert actual.getpixel((x, y)) == pytest.approx(expected.getpixel((x, y)), abs=12)


@pytest.mark.parametrize("ext", ["jpg", "jpeg", "png", "webp", "gif", "avif", "txt", "", "heics"])
def test_non_heif_is_identical_object_without_opening(monkeypatch, ext):
    content = b"not even an image"
    opener = MagicMock(side_effect=AssertionError("Must not open passthrough data"))
    monkeypatch.setattr(conversion.Image, "open", opener)
    assert conversion.web_content(content, ext) is content
    opener.assert_not_called()


@pytest.mark.parametrize("ext", ["heic", "heif", "HEIC", ".HEIF"])
def test_jpeg_full_dimensions_rgb_and_quality_95(ext):
    with pattern() as image:
        result = conversion.web_content(heic_bytes(image), ext)
        with Image.open(BytesIO(result)) as jpeg:
            assert jpeg.format == "JPEG"
            assert jpeg.mode == "RGB"
            assert jpeg.size == image.size
            assert JpegImagePlugin.get_sampling(jpeg) == 0
            # Compare quantization tables with a native Pillow quality-95 JPEG.
            with BytesIO() as reference:
                image.save(reference, format="JPEG", quality=95, subsampling=0)
                with Image.open(BytesIO(reference.getvalue())) as expected:
                    assert jpeg.quantization == expected.quantization
            assert_same_colors(jpeg, image)


@pytest.mark.parametrize("orientation", range(1, 9))
def test_orientation_baked_once_and_exif_gps_removed(orientation):
    transforms = {
        2: Image.Transpose.FLIP_LEFT_RIGHT,
        3: Image.Transpose.ROTATE_180,
        4: Image.Transpose.FLIP_TOP_BOTTOM,
        5: Image.Transpose.TRANSPOSE,
        6: Image.Transpose.ROTATE_270,
        7: Image.Transpose.TRANSVERSE,
        8: Image.Transpose.ROTATE_90,
    }
    exif = Image.Exif()
    exif[274] = orientation
    exif[315] = "Private synthetic author"
    exif[34853] = {1: "N", 2: (12.0, 34.0, 56.0)}
    with pattern() as image:
        content = heic_bytes(image, exif=exif)
        # Fixture must exercise a real oriented HEIF, not pre-rotated RGB.
        with Image.open(BytesIO(content), formats=["HEIF"]) as source:
            assert source.getexif().get(274) == 1
            if orientation != 1:
                assert source.info["original_orientation"] == orientation
        expected = image.transpose(transforms[orientation]) if orientation != 1 else image.copy()
        with expected, Image.open(BytesIO(conversion.web_content(content, "heic"))) as jpeg:
            assert_same_colors(jpeg, expected)
            assert not jpeg.getexif()
            assert "exif" not in jpeg.info
            assert "xmp" not in jpeg.info
            assert b"Private synthetic author" not in jpeg.info.get("exif", b"")


def test_only_primary_image_is_decoded_not_first_or_auxiliary(monkeypatch):
    with Image.new("RGB", (96, 64), "red") as first, Image.new("RGB", (40, 72), "blue") as primary:
        content = heic_bytes(first, save_all=True, append_images=[primary], primary_index=1)
    with Image.open(BytesIO(content), formats=["HEIF"]) as source:
        assert source.n_frames == 2
        assert source.tell() == 1
        assert source.info["primary"] is True
    original_load = pillow_heif.heif.HeifImage.load
    decoded = []

    def primary_load(image):
        assert image.info["primary"] is True
        decoded.append(image)
        return original_load(image)

    def forbidden(*args, **kwargs):
        raise AssertionError("Non-primary data must not be decoded")

    monkeypatch.setattr(pillow_heif.heif.HeifImage, "load", primary_load)
    monkeypatch.setattr(pillow_heif.heif.HeifThumbnail, "load", forbidden)
    monkeypatch.setattr(pillow_heif.heif.HeifAuxImage, "load", forbidden)
    monkeypatch.setattr(pillow_heif.heif.HeifDepthImage, "load", forbidden)
    assert pillow_heif.options.THUMBNAILS is False
    assert pillow_heif.options.DEPTH_IMAGES is False
    assert pillow_heif.options.AUX_IMAGES is False
    with Image.open(BytesIO(conversion.web_content(content, "heif"))) as jpeg:
        assert jpeg.size == (40, 72)
        assert jpeg.getpixel((20, 36)) == pytest.approx((0, 0, 255), abs=12)
    assert decoded
    assert len({id(image) for image in decoded}) == 1


def test_icc_preserved_and_other_metadata_not_copied():
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    with pattern() as image:
        content = heic_bytes(image, icc_profile=profile,
                             xmp=b'<x:xmpmeta xmlns:x="adobe:ns:meta/">private</x:xmpmeta>')
    with Image.open(BytesIO(content), formats=["HEIF"]) as source:
        assert source.info["icc_profile"] == profile
        assert source.info.get("xmp")
    with Image.open(BytesIO(conversion.web_content(content, "heic"))) as jpeg:
        assert jpeg.info["icc_profile"] == profile
        assert not jpeg.getexif()
        assert "xmp" not in jpeg.info


@pytest.mark.parametrize("content", [b"", b"private-file-token", b"\0\0\0\x18ftypheic"])
def test_corruption_has_only_safe_code(content):
    with pytest.raises(PublisherError, match="^invalid_heif_image$") as error:
        conversion.web_content(content, "heic")
    assert error.value.__suppress_context__ is True


def test_rejects_other_image_format_even_with_heic_extension():
    with Image.new("RGB", (16, 16), "green") as image, BytesIO() as output:
        image.save(output, format="PNG")
        with pytest.raises(PublisherError, match="^invalid_heif_image$"):
            conversion.web_content(output.getvalue(), "heic")


def mock_source(monkeypatch, size):
    source = MagicMock()
    source.width, source.height = size
    source.info = {}
    source.__enter__.return_value = source
    # Bounds are tested with mocked headers; the decoded RGB is deliberately tiny.
    source.convert.side_effect = lambda mode: Image.new(mode, (8, 8), "green")
    opener = MagicMock(return_value=source)
    monkeypatch.setattr(conversion.Image, "open", opener)
    return source, opener


def test_fixed_bounds():
    assert conversion.MAX_HEIF_PIXELS == 60_000_000
    assert conversion.MAX_CONVERTED_BYTES == 50 * 1024 * 1024


@pytest.mark.parametrize("size", [(8064, 6048), (10000, 6000)])
def test_48mp_and_exact_pixel_bound_are_accepted_without_large_allocations(monkeypatch, size):
    source, opener = mock_source(monkeypatch, size)
    assert conversion.web_content(b"synthetic-header", "heic").startswith(b"\xff\xd8")
    source.load.assert_called_once()
    source.convert.assert_called_once_with("RGB")
    assert opener.call_args.kwargs == {"formats": ["HEIF"]}


def test_pixel_bound_rejects_before_decode(monkeypatch):
    source, _ = mock_source(monkeypatch, (10001, 6000))
    with pytest.raises(PublisherError, match="^heif_pixel_bound$"):
        conversion.web_content(b"synthetic-header", "heif")
    source.load.assert_not_called()
    source.convert.assert_not_called()


def test_pixel_bound_rechecked_if_decoder_changes_dimensions(monkeypatch):
    source, _ = mock_source(monkeypatch, (8, 8))

    def load():
        source.width, source.height = 10001, 6000

    source.load.side_effect = load
    with pytest.raises(PublisherError, match="^heif_pixel_bound$"):
        conversion.web_content(b"synthetic-header", "heic")
    source.convert.assert_not_called()


@pytest.mark.parametrize("bomb", [Image.DecompressionBombError, Image.DecompressionBombWarning])
def test_pillow_pixel_guards_map_to_pixel_code(monkeypatch, bomb):
    def open_image(*args, **kwargs):
        if bomb is Image.DecompressionBombWarning:
            warnings.warn("private source details", bomb)
        raise bomb("private source details")

    monkeypatch.setattr(conversion.Image, "open", open_image)
    with pytest.raises(PublisherError, match="^heif_pixel_bound$") as error:
        conversion.web_content(b"synthetic-header", "heif")
    assert error.value.__suppress_context__ is True


def test_output_bound_exact_and_exceeded_using_small_mocked_limit(monkeypatch):
    with pattern() as image:
        content = heic_bytes(image)
    result = conversion.web_content(content, "heic")
    monkeypatch.setattr(conversion, "MAX_CONVERTED_BYTES", len(result))
    assert conversion.web_content(content, "heic") == result
    monkeypatch.setattr(conversion, "MAX_CONVERTED_BYTES", len(result) - 1)
    with pytest.raises(PublisherError, match="^converted_size_bound$"):
        conversion.web_content(content, "heic")


@pytest.mark.parametrize("stage", ["open", "load", "convert", "save"])
def test_internal_failures_never_expose_exception_text(monkeypatch, stage):
    raw_error = RuntimeError("private filename / token / native decoder details")
    if stage == "open":
        monkeypatch.setattr(conversion.Image, "open", MagicMock(side_effect=raw_error))
    else:
        source, _ = mock_source(monkeypatch, (8, 8))
        if stage in {"load", "convert"}:
            getattr(source, stage).side_effect = raw_error
        else:
            monkeypatch.setattr(conversion.Image.Image, "save", MagicMock(side_effect=raw_error))
    with pytest.raises(PublisherError, match="^invalid_heif_image$") as error:
        conversion.web_content(b"synthetic-header", "heic")
    assert error.value.__suppress_context__ is True


def test_rgba_heif_is_converted_to_rgb_jpeg():
    with Image.new("RGBA", (32, 24), (30, 90, 180, 128)) as image:
        content = heic_bytes(image)
    with Image.open(BytesIO(content), formats=["HEIF"]) as source:
        assert source.mode == "RGBA"
    with Image.open(BytesIO(conversion.web_content(content, "heic"))) as jpeg:
        assert jpeg.mode == "RGB"
        assert jpeg.size == (32, 24)
        assert jpeg.getpixel((16, 12)) == pytest.approx((30, 90, 180), abs=12)


def test_truncated_real_heic_is_rejected():
    with pattern() as image:
        content = heic_bytes(image)
    with pytest.raises(PublisherError, match="^invalid_heif_image$") as error:
        conversion.web_content(content[:len(content) // 2], "heif")
    assert error.value.__suppress_context__ is True
