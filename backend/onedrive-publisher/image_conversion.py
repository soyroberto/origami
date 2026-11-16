"""Web-only JPEG copies; OneDrive originals are never modified."""
from io import BytesIO
import warnings

from PIL import Image
import pillow_heif

from config import PublisherError

# Registration also calls the native library, failing host indexing if unavailable.
pillow_heif.register_heif_opener(thumbnails=False, depth_images=False, aux_images=False)

MAX_HEIF_PIXELS = 60_000_000
MAX_CONVERTED_BYTES = 50 * 1024 * 1024


def web_content(content: bytes, ext: str) -> bytes:
    """Convert only the primary HEIF image, at full resolution and JPEG quality 95."""
    if ext.lower().lstrip(".") not in {"heic", "heif"}:
        return content

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with BytesIO(content) as source, Image.open(source, formats=["HEIF"]) as image:
                # pillow-heif opens primary_index, not necessarily frame zero.
                if image.width * image.height > MAX_HEIF_PIXELS:
                    raise PublisherError("heif_pixel_bound")
                image.load()
                if image.width * image.height > MAX_HEIF_PIXELS:
                    raise PublisherError("heif_pixel_bound")
                # libheif bakes irot/imir; the plugin normalizes EXIF orientation.
                # Do not rotate again using info['original_orientation'].
                icc_profile = image.info.get("icc_profile")
                with image.convert("RGB") as rgb, BytesIO() as output:
                    rgb.info.clear()  # No GPS, EXIF, XMP or other source metadata.
                    rgb.save(output, format="JPEG", quality=95, subsampling=0,
                             icc_profile=icc_profile)
                    if output.getbuffer().nbytes > MAX_CONVERTED_BYTES:
                        raise PublisherError("converted_size_bound")
                    return output.getvalue()
    except PublisherError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise PublisherError("heif_pixel_bound") from None
    except Exception:
        raise PublisherError("invalid_heif_image") from None
