"""Synthetic HEIC integration: no OneDrive access, preserved versions and JPEG ownership."""
import copy
import hashlib
from io import BytesIO

import pytest
from PIL import Image
from pillow_heif import register_heif_opener

import resumable
import sync
from config import Library, MANAGED_PATH, PublisherError, content_version, manifest, photo_path
from graph import raster_signature
from image_conversion import web_content
from test_graph import client, item, response
from test_resumable import BatchMemory, Crash, Pages, auth_offline, config, page, run


@pytest.fixture
def heic():
    register_heif_opener()
    buf = BytesIO()
    Image.new("RGB", (48, 32), (50, 100, 150)).save(buf, "HEIF", quality=90)
    return buf.getvalue()


def source(data, ext="heic", ident="phone", tag="v1"):
    return {"id": ident, "size": len(data), "cTag": tag, "eTag": tag,
            "file": {"mimeType": "image/heic"}, "ext": ext}


class HeicPages(Pages):
    def __init__(self, sources, data):
        super().__init__([page(sources)])
        self.data = data

    def download(self, row, ext):
        assert self.expected_root == self.root_value
        self.downloads.append(row["id"])
        return self.data


@pytest.mark.parametrize("ext", ["heic", "heif"])
def test_graph_accepts_heic_and_downloads_original_bytes(heic, ext):
    entry = item(name="PHONE." + ext.upper())
    entry["size"] = len(heic)
    entry["file"]["mimeType"] = "image/heif"
    g = client([response({"id": "root", "folder": {}}), response({"value": [entry]})])
    rows, skipped = g.scan(Library("mx2026", "Carrusel/MX2026"))
    assert rows == [(entry, ext)] and skipped == {}
    g = client([response(entry), response(entry)], [response(content=heic)])
    assert g.download(entry, ext) == heic
    assert raster_signature(heic, ext)


def test_heic_paths_are_jpeg_but_raw_heic_manifest_still_forbidden(heic):
    row = source(heic)
    path = photo_path("mx2026", row["id"], content_version(row), "heic")
    assert path.endswith(".jpg") and MANAGED_PATH.fullmatch(path)
    with pytest.raises(PublisherError, match="unsafe_manifest_path"):
        manifest({"mx2026": {"items": {"x": {"path": path[:-3] + "heic"}}}})


def test_resumable_jpeg_digest_output_size_and_unchanged_no_conversion(heic, monkeypatch):
    batch = BatchMemory()
    row = source(heic)
    path = photo_path("spotify", row["id"], content_version(row), "heic")
    jpeg = web_content(heic, "heic")
    assert len(jpeg) != len(heic)
    graph = HeicPages([row], heic)
    assert run(batch, graph)["status"] == "ok"
    assert batch.blobs[path] == jpeg
    assert batch.metadata[path] == hashlib.sha256(jpeg).hexdigest()
    payloads = [p for name, (_, p) in batch.chunks.items() if "/copy/" in name]
    rec = payloads[-1]["records"][0]
    assert rec["bytes"] == len(jpeg) and rec["sha256"] == hashlib.sha256(jpeg).hexdigest()
    assert batch.durable["libraries"]["spotify"]["items"][row["id"]]["version"] == content_version(row)
    monkeypatch.setattr(resumable, "web_content", lambda *a: pytest.fail("Unchanged must not convert"))
    graph2 = HeicPages([row], heic)
    assert run(batch, graph2)["status"] == "unchanged"
    assert graph2.downloads == [] and len(batch.uploads) == 1


def test_modified_heic_converts_to_new_jpeg_path(heic):
    batch = BatchMemory()
    first, second = source(heic), source(heic, tag="v2")
    assert run(batch, HeicPages([first], heic))["status"] == "ok"
    assert run(batch, HeicPages([second], heic))["status"] == "ok"
    assert len(batch.uploads) == 2 and batch.uploads[0] != batch.uploads[1]
    assert all(path.endswith(".jpg") for path in batch.uploads)


def test_crash_after_upload_recovers_jpeg_and_next_run_reuses(heic):
    batch = BatchMemory()
    row = source(heic)
    batch.upload_hook = lambda _: (_ for _ in ()).throw(Crash())
    with pytest.raises(Crash):
        run(batch, HeicPages([row], heic))
    assert batch.control["job"]["intent_ref"] is not None
    batch.upload_hook = None
    retry = HeicPages([row], heic)
    assert run(batch, retry, start_new=False)["status"] == "ok"
    assert retry.downloads == [row["id"]]  # One proof download for ambiguous staged intent.
    assert len(batch.uploads) == 1
    unchanged = HeicPages([row], heic)
    assert run(batch, unchanged)["status"] == "unchanged" and unchanged.downloads == []


def test_corrupt_heic_omitted_and_not_retried_on_next_complete_scan(monkeypatch):
    batch = BatchMemory()
    data = b"broken-heic"
    row = source(data)
    cfg = config(skip_invalid=True)
    assert run(batch, HeicPages([row], data), cfg)["status"] == "ok"
    assert batch.blobs == {} and batch.durable["libraries"]["spotify"]["items"] == {}
    monkeypatch.setattr(resumable, "web_content", lambda *a: pytest.fail("Cached invalid must not convert"))
    graph = HeicPages([row], data)
    assert run(batch, graph, cfg)["status"] == "unchanged" and graph.downloads == []


def test_original_size_validation_precedes_conversion(heic, monkeypatch):
    batch = BatchMemory()
    row = source(heic)
    row["size"] += 1
    monkeypatch.setattr(resumable, "web_content", lambda *a: pytest.fail("Size race must abort before conversion"))
    result = run(batch, HeicPages([row], heic))
    assert result["status"] == "aborted" and result["reason"] == "source_or_scan_changed"
    assert batch.blobs == {}


def test_legacy_sync_publishes_jpeg_and_reuses_without_download(heic, monkeypatch):
    from helpers import FakeStore
    store = FakeStore()
    state = store.load()
    state.update(connected=True, cache="{}", client_id="client", owner="owner")
    store.save(state)
    row = source(heic)
    row.pop("ext")
    graph = type("Legacy", (), {"scan": lambda self, lib: ([(row, "heic")], {}),
                               "download": lambda self, *args: heic, "close": lambda self: None})()
    monkeypatch.setattr(sync, "silent_token", lambda *a: "token")
    assert sync.sync_locked(store, state, config(), graph_factory=lambda token: graph)["status"] == "ok"
    path = photo_path("spotify", row["id"], content_version(row), "heic")
    assert store.blobs[path] == web_content(heic, "heic")
    graph.download = lambda *a: pytest.fail("Unchanged legacy must not download")
    assert sync.sync_locked(store, state, config(), graph_factory=lambda token: graph)["status"] == "ok"


@pytest.mark.parametrize("ext", ["heic", "heif"])
@pytest.mark.parametrize("mime", ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "application/octet-stream"])
def test_paged_scan_accepts_heif_mime_variants(ext, mime):
    from test_paged_graph import ROOT, client as paged_client, response as paged_response, source as paged_source
    entry = paged_source(ext=ext.upper(), file={"mimeType": mime})
    graph = paged_client([paged_response({"value": [entry]})])
    result = graph.scan_page(ROOT)
    assert result["skipped"] == {} and len(result["rows"]) == 1
    assert result["rows"][0]["ext"] == ext
    assert result["rows"][0]["file"] == {"mimeType": mime}


def test_heif_record_cannot_claim_size_for_original_jpeg():
    from test_resumable import row
    src = row("ordinary")
    pages = [page([src])]
    record = resumable._record(src, "spotify")
    record["bytes"] = None
    with pytest.raises(PublisherError, match="invalid_private_ledger"):
        resumable._batch_payload({"start": [0, 0], "end": [1, 0], "records": [record]}, pages, "spotify")
