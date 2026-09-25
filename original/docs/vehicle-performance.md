# Vehicle performance calibration

These are representative real vehicle classes for the generated, unbranded designs in
`car-reference.md`, not claims that the models reproduce a particular manufacturer.
The game uses its authored geometry scale and existing gravity; parameters are calibrated against
measured road speed and elapsed simulation time rather than copied as if it were a full-scale simulator.

| Vehicle | Evidence | Calibration target |
|---|---|---|
| City Pod | Fictional body; [2017 smart fortwo electric drive manufacturer data](https://media.mercedes-benz.fr/nouvelle-propulsion-smart-electric-drive-la-solution-de-motorisation-ideale-pour-la-citadine-ideale/) supplies a representative city-EV baseline: 130 km/h and 11.5 s to 100. | 145 km/h; 0–100 in 7–12.7 s — the power needed for 90 mph makes it about 8 s. |
| Sedan | Original unbranded body. Its ordinary family-car performance is a game-design target rather than a claim about the visual reference. | 180 km/h; 0–100 in 7–10 s; predictable braking and stable all-wheel-drive traction. |
| Sports car | [Ford's 2024 Mustang specification](https://www.ford.co.uk/support/how-tos/support-search-only/vehicle-index/ford-mustang-2024) lists 155 mph and 4.9 s to 62 mph for the automatic. | 354 km/h; 0–100 in 4–6 s. |
| Lightweight sports | Original unbranded design; its performance gap is a game choice rather than a claim about a production model. | 290 km/h; lower mass, faster steering response and a tighter same-speed line than the high-performance sports car. |
| Short jeep | [Wrangler Sahara 2-door specification](https://www.media.stellantis.com/rs-rs/download-model-document/20) gives 180 km/h, 7.3 s to 100, 2.459 m wheelbase and 10.36 m turning diameter. | 180 km/h; 0–100 in 6–9 s; short wheelbase and slower steering than the sports car. |
| Pickup | [Direct instrumented F V6 test](https://www.caranddriver.com/reviews/a15125561/2011-ford-f-37-v6-test-review/) measured 100 mph governor and 7.6 s to 60 mph. This tested cab differs from our single-cab body. | 161 km/h solo, 0–100 in 7–11 s. With our 700 kg trailer, 115–145 km/h and 11–25 s are estimates, produced through hitch load and trailer drag. |
| Monster truck | Original unbranded show-truck design; its oversized tyres and suspension are authored arcade traits rather than a production-model claim. | 170 km/h; slower steering, longer suspension travel and more body motion than the ordinary pickup, while remaining viable on every course. |
| School bus | [Blue Bird Vision](https://www.blue-bird.com/vision-diesel/) specifies 200–300 hp, several wheelbases and 50° wheel cut. There is no universal top speed or acceleration figure on that page. | 129 km/h and 10–55 s to 100; gradual keyboard steering, long turning radius. |
| Retro van | [Volkswagen's T1 history](https://media.volkswagen.fr/75-ans-du-combi-volkswagen-vehicules-utilitaires-fete-lanniversaire-de-son-modele-le-plus-emblematique/?lang=fr) gives 44 hp and 105 km/h for the later T1. | 105 km/h; estimated 30–80 s to 100, tall narrow body remains vulnerable to a curb trip. |

the player set top speeds of 90 mph (City Pod), 220 mph (sports car),
180 mph (lightweight sports), 112 mph (jeep, unchanged) and 80 mph (school bus), with gravity
unchanged and power raised until each is reached from rest on the longest Bayshore 101 straight
that speed allows (`game/test/vehicle-top-speed.test.ts`). Power became 750 kW, 370 kW, 210 kW and 50 kW
for the sports car, lightweight, bus and City Pod; the bus's 210 kW sits inside the 200–300 hp the cited
Blue Bird range allows, and makes its 0–100 about 11.6 s.

Sources checked. Estimates are not manufacturer specifications. Towing performance is
not a legal road speed limit; neither a break-in recommendation nor a trailer's rating is treated
as an engine's top speed. No trademarks are added to the game.

Runtime values remain owned by `game/src/vehicles/catalogue.json`. Wheel power caps force as speed
rises; drag acts on each physical body. A trailer adds both mass and frontal resistance through
its real joint. Steering respects requested curvature below the ceiling, with per-vehicle slew
rates that slow further at speed. Safety assistance retains each body's existing roll-recovery
boundary; it does not lock bodies upright.

Measured results: `tools/baselines/performance/performance.json` and `driving-metrics.json`.
`performance/before.json` retains the immediately preceding seven-car acceleration measurement. Reproduce with
`cd game && npx vitest run test/vehicle-driving.test.ts`.

A passive trailer receives rolling resistance (estimated coefficient 0.015), not the engine braking of a powered car. Actual measured towing top speed is 119.6 km/h versus 161.0 km/h solo; 0–100 takes 13.3 s versus 8.0 s.

The robot converts pursuit curvature through the same speed-dependent steering range as player
input, and plans below each car's lateral-acceleration budget. Full-road validation also exposed
a guardrail through the San Tomas hairpin: rail spans are now clipped against the actual driving
surface. Extra engine force is not used to push a car through a misplaced rail.

Sedan geometry was replaced. Its updated measurements are in
`tools/baselines/sedan/`: both complete road runs finished with zero resets, and the
controlled roll boundary moved from 16.5 to 17.5 rad/s as the body became wider and lower.

Uniformly enlarges the seven bodies and physical geometry by 20%. Mass and power
remain unchanged; rotational inertia scales by 1.2 squared. Keeping the old inertia made the
long school bus oscillate in pitch and limited it to 78.9 km/h; the matched inertia restores
105.0 km/h without extra engine force. Updated measurements are in `tools/baselines/scale/`.

Rechecked every cited source, including the direct instrumented F test (a primary
measurement, not a factory claim). Mustang, Wrangler, towing, bus and vintage-van acceleration
and speed already match their stated targets; their power is retained. Bus and trailer targets
remain explicitly estimated because the manufacturer does not give a universal combination figure.
All seven cars' brakes are recalibrated to 6.5–10.5 m/s² dry deceleration, an estimated class range,
not copied factory specifications. The existing F test measured a 184 ft stop from 70 mph
(about 8.7 m/s²); our pickup target is 8.5 m/s² before trailer braking. The common dry 90 km/h
stop test requires 27–52 m instead of accepting the previous roughly 10–25 m. No reaction time
is included. Mass, geometry and game gravity remain at the existing game scale; this is a
measured performance calibration, not an exact full-size vehicle simulation.

The 120 km/h Sedan cap was present in current source, not a unit-conversion cap at 65 mph.
HUD speed is the physical velocity converted into the selected unit; the new regression also
compares velocity with actual displacement over five seconds. the player's running URL/build
was not supplied, so this does not claim to identify their cached build.

The weaker, realistic brakes also require a more conservative acceptance driver: braking and
cornering planning use half the selected car's available straight-line brake and lateral budgets.
Production curvature is unsigned (`pipeline/sr/geom.py`); Spline preserves that magnitude and
adds the horizontal turn sign from neighbouring tangents only for steering-reversal planning.
This prevents a left-to-right bend being treated as two turns in the same direction. The driver
is intentionally not a maximum-speed performance test; the dry straight-line measurements above are.

Wheel contact velocities now come from Rapier's `velocityAtPoint`, after converting the world
contact through `PhysicsWorld.toLocal`; this accounts for both the floating origin and each car's
offset centre of mass. The previous hand-written calculation rotated around the model origin;
this misreported tyre and damper velocities during pitch/roll, especially on the low-COM trailer.
The synthetic roll-pulse thresholds were re-measured after this correction: the high van still
rolls first, normal turns remain upright, and deliberate over-limit inputs still roll each car.

The flat-ground measurement runs through `PhysicsWorld.step`, including the same floating-origin
rebasing as gameplay. Directly stepping Rapier skipped this path and accumulated position rounding
at kilometre-scale coordinates; the unchanged 0.2 km/h displacement agreement check caught it.

Adds the lightweight sports car as a separate handling choice. The same dry flat-road
input at 18 m/s is recorded in `tools/baselines/lightweight-sports/handling.json`; the existing
wide sports car keeps the higher top speed, while the shorter and lighter car turns onto the line
more quickly. These are authored arcade targets and do not represent a named production vehicle.

Adds the Monster Truck as a separate pickup-based choice. Its 0.42 m suspension travel,
2,800 kg mass and giant tyres make its height and weight perceptible without adding vehicle-crushing
rules. These are authored arcade targets and do not represent a named production vehicle.

Replaces the Sedan's former performance-car calibration with ordinary family-car pace.
Its all-wheel-drive layout remains for a stable, approachable exit from corners, but no longer
implies performance acceleration or a 250 km/h top speed. The same task assigns actual driven
axles to all nine garage vehicles: torque reaches only those tyres, and each driven tyre spends
the same friction budget on propulsion and cornering. The passive trailer receives no engine force.
