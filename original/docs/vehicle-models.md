# Vehicle model contract

The vehicle definitions live in `game/src/vehicles/catalogue.json`. Blender reads that same JSON;
runtime helpers live in `catalogue.ts`. Do not copy dimensions or wheel positions into generators.
The selected appearance references are in [car-reference.md](car-reference.md).

Rebuild the compact cars from the repository root (Blender 5.x, no downloads):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python assets-src/vehicles/build_compact_cars.py
```

Append `-- --render-dir tmp/vehicle-views` to export front/side/rear/chase inspection images,
or `-- --ids micro-hatch` to rebuild one car. The scripts read the catalogue directly.

Rebuild City Pod with `assets-src/vehicles/build_city_pod.py`; its menu image is rendered
from the exported GLB, following the selected B concept.

Rebuild the school bus, retro van, pickup and separate single-axle trailer:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python assets-src/vehicles/build_large_cars.py
```

Append `-- --render-dir tmp/vehicle` for twelve views. Pickup views import the two exported
GLBs and align their hitch markers; these are asset inspection poses, not simulated joint motion.
The game loader and articulated suspension are separate runtime work.

- Units: game metres. The catalogue contains final dimensions; each body's `detailScale` (the
  root value is only the default) converts the original authored details to that size during
  export. Builders receive dimensions divided by this factor; export bakes it into vertices and
  node translations, and the runtime derives `inertiaScale` from its square. Export at identity
  scale; never scale again in the loader. increased both models and matching physics by
  20% sizes every body at about 0.7 of its real counterpart, so the factor differs per
  body (the monster truck was reshaped in its builder inputs instead and keeps 1.2).
- glTF axes: X right, Y up, forward −Z. Blender uses X right, Z up, forward +Y before its standard
  glTF Y-up conversion. Convert catalogue vectors to Blender with `(x, -z, y)`.
- Origin: centre of the chassis collider, not the ground or centre of mass. Collider half extents
  come from `chassisHalf`; `size` is the approximate whole visible body including wheels.
- One identity `vehicle-root`, with direct children `body`, `wheel-0` through `wheel-3`,
  and `hitch` where present. The separate travel trailer has only `wheel-0` and `wheel-1`.
- Wheel order: front-left, front-right, rear-left, rear-right. Trailer order: left, right.
  Centre is `(±track/2, anchorY - suspensionRest + wheelRadius, axleZ)`; its pivot is the tyre centre.
  The existing physics measures `suspensionRest` to the road contact, not the wheel centre.
  Bake mesh rotation/scale so each wheel pivot has identity rotation and scale, spins around X,
  and steers around Y. Keep tyres, hubs and spokes beneath the moving wheel node.
- `body` owns stationary geometry, including the jeep spare tyre. No collider is exported.
  The runtime uses the catalogue to create the physics shape and ray origins.
- Pickup and trailer are separate GLBs, each with its own local hitch marker. Align the world
  hitch positions when assembling, preserving their visible gap. `Trailer` owns a spherical
  physics joint and a passive two-wheel `Car`; body contacts stop jackknifing through the pickup.
  Both bodies use independent interpolated poses. A towing reset recreates the joint at aligned
  anchors, clears momentum, and collapses the trailer's render history.
- Self-contained GLB with embedded materials/textures, no cameras/lights/animations. Output:
  `game/public/models/cars/<body.id>.glb`. These small self-made outputs are tracked and Vite
  copies them unchanged. Generator scripts belong in `assets-src/` creates no model.

Legacy `track.car` stays compatible. `legacyDefaults` maps it to a canonical vehicle; invalid saved
choices fall back through `resolveVehicle`.
The runtime loads the selected GLB before constructing a new driving session. Each model owns
its geometry/materials, and cancellation or teardown releases them. URL automation accepts
`?track=shoreline&bot=1&vehicle=school-bus`; add `dev=1&inspect=vehicle` to pause the actual chase
view after driving ten metres. Invalid IDs fall back to the route default.
The catalogue's `tuning` selects a compatible legacy base; `handling` holds the vehicle's actual
calibration. `vehicleTuning` merges that base, the handling profile and the immutable geometry,
in that order. Runtime and driving tests use this same entry point. The passive trailer has its
own handling profile in the same catalogue.

The upright helper only acts between `uprightLimit` and `uprightRecoveryLimit`. Once a trip exceeds
the latter angle, the rigid body can roll; tall vehicles do not have an invisible upright lock.
`game/test/vehicle-driving.test.ts` measures all complete rigs on one flat-road fixture and
writes `tools/baselines/vehicles/driving-metrics.json`. The roll column measures an applied
roll-rate pulse, not a claim that real-road rollover is determined by a single speed.

Slime resistance uses the same catalogue handling profiles: `ramMultiplier` scales a finite
impact impulse, and `slickGripMultiplier` controls the remaining wet grip. Live slimes no longer apply timed tyre-slip effects. A popper adds only splash
feedback. A shared burst divides its size-scaled impulse between simultaneously touching connected
bodies. The trailer receives its own tyre contacts; boost only pushes bodies with grounded contact.

Windshield exposure comes from front-facing triangles in the GLB glazing material, not another
set of authored dimensions (export batches the source panes by material). Splash rays test the actual bonnet, roof and body for occlusion; the
result scales the full 0.6-second wipe. A giant envelops a connected combination and uses forces
and torques, never shell rotation teleports, until the last body leaves its volume.

Validate generated GLBs through the same Three.js loader used in the browser:

```sh
cd game
npm test -- test/vehicle-assets.test.ts
```

Missing requested assets fail. The default suite requires all production bodies and reports
their combined size against the shared raised hard line. See
`vehicleModelErrors` for machine-enforced geometry checks.
