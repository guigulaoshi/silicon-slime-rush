""
from sr.landmark_data import entries


def build(names, frame, dem):
    """Validate the named landmarks against ``landmarks.json``; always returns None.

    Every entry is a "glb" model, placed by the game at runtime rather than generated here, so
    there is no mesh to build. This still exists to turn a typo'd route landmark id into a build
    failure instead of a silently empty skyline.
    """
    specs = entries()
    for name in names or ():
        entry = specs.get(name)
        if entry is None or entry.get("kind") != "glb":
            raise KeyError(f"unknown landmark {name!r}; known: {sorted(specs)}")
    return None
