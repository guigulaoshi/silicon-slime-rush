from collections import Counter
import numpy as np
import pytest
from shapely.geometry import Polygon
from sr.architecture import house_details, house_style
from sr.mesh import geometric_normals


@pytest.mark.parametrize("roof,expected", [("flat","ranch"),("gable","gable-porch"),("hip","courtyard")])
def test_valley_houses_use_the_existing_roof_choice(roof,expected):
    
    assert house_style("beijing",roof,7) == expected
    assert house_style("beijing",roof,9) == expected


@pytest.mark.parametrize("style", ["ranch","gable-porch","courtyard","bay-front"])
def test_house_entrances_are_closed_finite_parts_outside_the_wall(style):
    poly=Polygon([(0,0),(12,0),(12,10),(0,10)])
    parts=house_details(poly,0,9,style,(6,-40))
    assert parts, "each residential style must generate real architectural geometry"
    assert min(m.positions[:,2].min() for m in parts)<-.8
    assert any(m.material=="trunk" for m in parts), "a real door must be present"
    for mesh in parts:
        assert np.isfinite(mesh.positions).all()
        triangles=mesh.indices.reshape(-1,3)
        normals=geometric_normals(mesh.positions,triangles)
        assert np.all(np.linalg.norm(normals,axis=1)>1e-6)
        assert np.all(np.einsum("ij,ij->i",normals,mesh.normals[triangles].mean(axis=1))>0)
        points=[tuple(np.round(p,5)) for p in mesh.positions]
        edges=Counter(tuple(sorted((points[a],points[b])))
            for tri in triangles for a,b in zip(tri,np.roll(tri,-1)))
        openings=[edge for edge,n in edges.items() if n%2]
        if openings:
            # The shared pitched_roof is an open-bottom cap, seated on the closed porch slab.
            floor=float(mesh.positions[:,1].min())
            assert mesh.material.startswith("house_roof_")
            assert all(abs(point[1]-floor)<1e-5 for edge in openings for point in edge)
            assert any(other is not mesh
                and abs(float(other.positions[:,1].max())-floor)<1e-5
                and np.all(other.positions[:,[0,2]].min(axis=0)<=mesh.positions[:,[0,2]].min(axis=0)+1e-5)
                and np.all(other.positions[:,[0,2]].max(axis=0)>=mesh.positions[:,[0,2]].max(axis=0)-1e-5)
                for other in parts), "the open roof underside must be covered by its solid porch slab"
    if style=="bay-front":
        # No projecting window frame or glass, only the entrance, cornice and steps.
        assert not any(m.material=="building_landmark_glass" for m in parts)
        assert all(float(np.ptp(m.positions[:,1])) < 2.5 for m in parts if m.material=="house_trim")
    else:
        assert any(m.material.startswith("house_roof_") for m in parts)


def test_decorations_do_not_regrow_over_a_road_after_the_house_was_clipped():
    poly=Polygon([(0,0),(12,0),(12,10),(0,10)])
    road=Polygon([(-20,-20),(30,-20),(30,-.01),(-20,-.01)])
    for style in ("ranch","gable-porch","courtyard","bay-front"):
        parts=house_details(poly,0,9,style,(6,-40),road)
        assert not parts, "every outward decoration would enter this flush street"


def test_small_sheds_do_not_receive_a_house_entrance():
    assert not house_details(Polygon([(0,0),(3,0),(3,3),(0,3)]),0,2,"ranch",(0,-40))


@pytest.mark.parametrize("style", ["bay-front", "gable-porch"])
def test_hillside_entrances_and_supports_use_the_finished_street_ground(style):
    poly=Polygon([(0,0),(12,0),(12,10),(0,10)])
    ground=lambda points: 3+np.asarray(points)[:,1]*.6
    parts=house_details(poly,6,15,style,(6,-40),ground_at=ground)
    door=next(part for part in parts if part.material=="trunk")
    assert door.positions[:,1].min()==pytest.approx(ground(np.array([[6,-.8]]))[0])
    supports=[part for part in parts if part.material=="building_concrete" or
              (style=="gable-porch" and part.material=="house_trim" and np.ptp(part.positions[:,0])<.3)]
    assert supports
    for part in supports:
        floor=float(part.positions[:,1].min())
        assert floor < float(ground(part.positions[:,[0,2]]).min()), "steps/posts must reach below all sampled ground"
