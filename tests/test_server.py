from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from quicksortplayer.server import app


client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_lists_folder_with_categories(tmp_path: Path):
    (tmp_path / "Folder").mkdir()
    (tmp_path / "photo.jpg").write_bytes(b"not decoded in a list")
    (tmp_path / "clip.mp4").write_bytes(b"not decoded in a list")
    response = client.get("/api/list", params={"path": str(tmp_path)})
    assert response.status_code == 200
    items = {item["name"]: item for item in response.json()["items"]}
    assert items["Folder"]["is_dir"] is True
    assert items["photo.jpg"]["category"] == "images"
    assert items["clip.mp4"]["category"] == "videos"


def test_image_thumbnail(tmp_path: Path):
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (800, 400), "#4cb3f0").save(image_path)
    response = client.get("/api/thumbnail", params={"path": str(image_path)})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")


def test_static_app_loads():
    response = client.get("/")
    assert response.status_code == 200
    assert "Quick Sort" in response.text
