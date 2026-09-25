"""The one thing a road may never have on it: a building.

This is checked on the assembled geometry rather than on the footprints it came from, because the
footprints are not what ships. Between the two there is a corridor polygon, a clip, a per-tile
split and a merge, and a bug in any of them puts a wall across the road -- which is what happened:
the footprint filter was right and the mesh was extruded from the unfiltered polygon anyway, and
nine of the eleven routes shipped with buildings standing in the road.

So the build asks the finished triangles, and refuses to write a track that fails."""
import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

MIN_TRI = 0.25        # square metres: below this a triangle is a sliver from a clip, not geometry
MIN_OVERLAP = 0.25    # and an overlap this small is two surfaces meeting, not one standing on the other

def _triangles(meshes, min_area=MIN_TRI):
    out = []
    for mesh in meshes:
        if mesh is None or mesh.is_empty():
            continue
        P = np.asarray(mesh.positions)[:, [0, 2]]
        for tri in np.asarray(mesh.indices).reshape(-1, 3):
            poly = Polygon(P[tri])
            if poly.is_valid and poly.area > min_area:
                out.append(poly)
    return out


def surface(*meshes):
    """The ground a set of road meshes covers, as one polygon."""
    return unary_union(_triangles(meshes, min_area=0.0))


def buildings_over_the_road(surfaces, buildings):
    """Every place a building triangle covers ground drawn as tarmac, as (area, x, z).

    Side streets count. The car never has to touch one, but the player can see it and can drive
    onto it, and a street that ends in a wall reads as the road being cut in half -- which is what
    it looked like where the Mountain View loop turns off North Shoreline and the street carries
    straight on into a building."""
    road = _triangles(surfaces)
    walls = _triangles([buildings])
    if not road or not walls:
        return []
    tree = STRtree(road)
    out = []
    for wall in walls:
        nearby = tree.query(wall, predicate="intersects")
        if not len(nearby):
            continue
        # Road triangles outside this building cannot contribute to its overlap. Union the
        # local candidates so overlapping road ribbons still count each square metre once.
        local_surface = unary_union([road[i] for i in nearby])
        hit = wall.intersection(local_surface)
        if not hit.is_empty and hit.area > MIN_OVERLAP:
            c = hit.centroid
            out.append((float(hit.area), float(c.x), float(c.y)))
    out.sort(reverse=True)
    return out
