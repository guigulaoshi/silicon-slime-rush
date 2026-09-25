"""Small, closed architectural parts keyed to the existing regional roof profiles."""
import numpy as np
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from sr.mesh import box, pitched_roof, yaw_for_x_axis


def house_style(route_id, roof, height):
    """Which residential facade to build, chosen from the route's own roof mix.

    `route_id` and `height` are kept in the signature for callers and tests: no current route can
    make this return anything but a roof-shape match ("bay-front" was reachable only through an old
    route's own `vista.houseStyle` field naming a Bay Area profile; none of the 15 current tracks --
    or any synthetic one -- sets it, so that branch was proven dead and removed). `house_details`
    still accepts "bay-front" directly and is tested against it.
    """
    if roof == "hip":
        return "courtyard"
    if roof == "gable":
        return "gable-porch"
    return "ranch"


def roof_material(style):
    return "house_roof_tile" if style == "courtyard" else "house_roof_slate"


def house_details(poly, ground, top, style, towards, keep_clear=None, ground_at=None):
    """Front door, framed bay or supported porch, kept out of every visible road.

    Only the street-facing wall gets the larger accents. Each component has an explicit footprint
    used by the same road-clearance predicate, including a roof's full rectangular extent.
    """
    ring = np.asarray(orient(poly, sign=1).exterior.coords[:-1])
    choices = []
    for a, b in zip(ring, np.roll(ring, -1, axis=0)):
        length = np.linalg.norm(b-a)
        if length < 4:
            continue
        tangent = (b-a)/length
        normal = np.array([tangent[1], -tangent[0]])
        middle = (a+b)/2
        facing = np.dot(np.asarray(towards)-middle, normal)
        if facing > 0:
            choices.append((facing, middle, tangent, normal, length))
    if not choices:
        return []
    _, middle, tangent, normal, length = max(choices, key=lambda row: row[0])
    if ground_at is not None:
        ground = float(ground_at(np.asarray([middle+normal*.8]))[0])
    if top-ground < 2.7:
        return []
    yaw = yaw_for_x_axis(tangent)
    parts = []

    def place(across, out, y, half, material, grounded=False):
        centre = middle+tangent*across+normal*out
        corners = [centre+tangent*x+normal*z for x,z in
                   [(-half[0],-half[2]),(half[0],-half[2]),(half[0],half[2]),(-half[0],half[2])]]
        footprint = Polygon(corners)
        if keep_clear is not None and footprint.intersects(keep_clear):
            return None
        if grounded and ground_at is not None:
            bottom = float(np.min(ground_at(np.asarray(corners)))) - .15
            upper = y + half[1]
            if upper <= bottom:
                return None
            y = (bottom + upper) / 2
            half = (half[0], (upper-bottom)/2, half[2])
        m = box((centre[0], y, centre[1]), half, yaw=yaw, material=material)
        parts.append(m)
        return centre

    # A normal-sized entrance immediately breaks the office-window scale of the old box.
    door = -min(length*.22, 2.4) if style == "bay-front" else 0.
    place(door,.035,ground+1.05,(.48,1.05,.055),"trunk")
    for side in (-1,1):
        place(door+side*.58,.07,ground+1.12,(.085,1.12,.12),"house_trim")
    place(door,.07,ground+2.28,(.66,.09,.12),"house_trim")
    # Window sills and the cornice sit clear of the wall, never as coplanar paper rectangles.
    place(0,.08,top-.12,(length/2,.12,.16),"house_trim")
    if style == "bay-front":
        # No projecting bay windows. the player found the framed glass boxes stuck on the wall
        # "莫名其妙"; the facade texture's own windows remain.
        for step in range(3):
            place(door,.35+(2-step)*.3,ground+.07+step*.08,
                  (.8,.07+step*.08,.42),"building_concrete",grounded=True)
    else:
        half_width = min(length*.30,3.1)
        roof_y = ground+2.7
        centre = place(0,.7,roof_y,(half_width,.13,.85),roof_material(style))
        if centre is not None:
            for side in (-1,1):
                place(side*(half_width-.18),1.28,ground+1.3,(.11,1.3,.11),"house_trim",grounded=True)
            if style == "gable-porch":
                parts.append(pitched_roof((centre[0],roof_y+.13,centre[1]),
                    (half_width,.85),yaw,1.0,"gable",roof_material(style)))
        if style == "courtyard":
            for side in (-1,1):
                place(side*min(length*.32,3.8),.08,ground+1.65,(.15,1.1,.10),"trunk")
        if style == "ranch":
            for across in np.linspace(-length*.35,length*.35,5):
                place(across,.08,ground+2.5,(.035,.38,.12),"house_trim")
    return parts
