import numpy as np
from PIL import Image

from sr.fetch_dem import decode, tile_bounds_deg, tile_xy, tiles_for_bbox
from sr.routes import all_route_ids, bbox, corridor_points, load_route


def test_all_routes_load_and_have_waypoints():
    ids = all_route_ids()
    # The floor was 8, from when there were eleven routes; we deleted five, so that
    # number was asserting a roster the project no longer wants. What is still a rule: there are
    # routes, and every one of them loads.
    assert len(ids) >= 3 and "sydney" in ids
    for rid in ids:
        r = load_route(rid)
        assert len(r["waypoints"]) >= 3 and r["origin"]["lat"] and r["mode"] in ("loop", "p2p", "multistop")
        assert corridor_points(r)


def test_bbox_padding_in_meters():
    r = load_route("sydney")
    s, w, n, e = bbox(r, 300)
    lats = [p[0] for p in corridor_points(r)]
    assert abs((min(lats) - s) * 111_320 - 300) < 1


def test_tile_xy_matches_known_tile():
    # Tiananmen Gate (pipeline/routes/beijing.json origin, 39.89875, 116.389816) at z15 lands on the
    # tile that contains it, and its bounds bracket the point
    x, y = tile_xy(39.89875, 116.389816, 15)
    s, w, n, e = tile_bounds_deg(x, y, 15)
    assert s <= 39.89875 <= n and w <= 116.389816 <= e
    mid_lat, mid_lon = (s + n) / 2, (w + e) / 2
    assert tiles_for_bbox(mid_lat - 1e-4, mid_lon - 1e-4, mid_lat + 1e-4, mid_lon + 1e-4, 15) == [(x, y)]


def test_terrarium_decode(tmp_path):
    img = np.zeros((256, 256, 3), dtype=np.uint8)
    img[:, :, 0] = 128; img[:, :, 1] = 10; img[:, :, 2] = 128  # 128*256 + 10 + 0.5 - 32768 = 10.5
    p = tmp_path / "t.png"; Image.fromarray(img).save(p)
    h = decode(str(p))
    assert h.shape == (256, 256) and abs(float(h[0, 0]) - 10.5) < 1e-6


def test_long_route_fetch_follows_ordered_reference_waypoints():
    from sr.routes import fetch_boxes
    route = {"id": "long", "corridorFetch": True, "waypoints": [[37, -122],
             {"ref": "US 101", "pick": "nearest:37.1,-122.1"}, [37.2, -122.2]]}
    assert corridor_points(route) == [(37, -122), (37.1, -122.1), (37.2, -122.2)]
    boxes = fetch_boxes(route, 100)
    assert len(boxes) == 2
    assert boxes[0][0] < 37 and boxes[0][2] < 37.11
    assert boxes[1][0] > 37.09 and boxes[1][2] > 37.2
    route.pop("corridorFetch")
    assert fetch_boxes(route, 100) == [bbox(route, 100)]
