import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { baselinePath, evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } },
  viewport: { width: 1280, height: 720 } });
const OUT = evidencePath('slime-overhaul');

test('records forward, oblique and reverse collision-led liquid splashes', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=day&vehicle=sedan');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'directional splash drive');
  const results: unknown[] = [];
  for (const scenario of [{ name: 'forward', along: 1, across: 0 },
    { name: 'oblique', along: .72, across: .69 },
    { name: 'reverse', along: -1, across: 0 }]) {
    const result = await page.evaluate(({ along, across, name }) => {
      const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
      g.autopilot = false; g.phase = 'paused'; layer.fallingLimit = 0;
      for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
      const i = spline.indexAt(30), p = spline.point(i), t = spline.tangent(i), r = spline.right(i);
      const direction = layer.position.clone().set(t[0] * along + r[0] * across, 0,
        t[2] * along + r[2] * across).normalize();
      // Step a deliberately overlapping car and slime through the production Rapier loop. This
      // isolates contact-led spray from the drivetrain's attempt to straighten sideways motion.
      const carCentre = layer.position.clone().set(p[0], p[1] + 2.05, p[2]);
      const centre = carCentre.clone().addScaledVector(direction, 1.5);
      s.car.reset(carCentre.toArray(), Math.atan2(-t[0], -t[2]));
      s.car.body.setLinvel({ x: direction.x * 16, y: 0, z: direction.z * 16 }, true);
      layer.effects.particleBorn.fill(-100); layer.effects.nextParticle = 0;
      const before = layer.stats.feedback.hits.popper;
      layer.addTile(`directional-impact-${name}`, [{ kind: 'popper',
        position: centre.toArray(), scale: [2.5, 2.05, 2.5], yaw: 0 }]);
      s.racers[0].chase.update = (camera: any) => {
        camera.position.set(centre.x + 10, centre.y + 8, centre.z + 12);
        camera.lookAt(centre); camera.fov = 50; camera.updateProjectionMatrix();
      };
      for (let step = 0; step < 5; step++) s.physics.step(s.physics.timestep, (dt: number) => {
        layer.prepareCar(s.car); s.car.update(dt, { throttle: 0, brake: 0, steer: 0 });
        layer.handleCar(s.car); layer.update(dt);
      });
      const effects = layer.effects;
      const velocity = effects.particleVelocity, born = effects.particleBorn;
      let count = 0, projection = 0;
      for (let i = 0; i < born.length; i++) if (born[i] > effects.clock - .25) {
        projection += velocity.getX(i) * direction.x + velocity.getZ(i) * direction.z;
        count++;
      }
      return { count, meanForward: projection / Math.max(1, count), hit: layer.stats.feedback.hits.popper > before,
        particles: layer.stats.particles, fragments: layer.stats.physicalFragments };
    }, scenario);
    expect(result.hit).toBe(true);
    expect(result.count).toBeGreaterThan(20);
    expect(result.meanForward).toBeGreaterThan(4);
    results.push({ ...scenario, ...result });
    await page.screenshot({ path: resolve(OUT, `splash-${scenario.name}.png`) });
  }
  writeFileSync(resolve(OUT, 'directional-splashes.json'), JSON.stringify(results, null, 2));
  const video = page.video();
  await page.close();
  await video?.saveAs(resolve(OUT, 'directional-splashes.webm'));
});

// @pixel: its reference image was recorded with SwiftShader, so it runs in the software pass.
test('shows smooth unstriped bodies and pure black bombs in rainy night lighting', { tag: '@pixel' }, async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=night&weather=rain&vehicle=sedan');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'rainy-night slime surface');
  const report = await page.evaluate(() => {
    const g = window.game as any, s = g.session, layer = s.slimes, camera = s.world.camera;
    g.phase = 'paused'; g.autopilot = false;
    // Rain still defines the lighting and fog, but its falling line geometry and the HUD clock
    // are deliberately excluded from a pixel regression because both advance with wall time.
    s.world.sky.update = () => false;
    s.world.sky.rain.visible = false;
    s.world.sky.dome.material.uniforms.uTime.value = 0;
    document.querySelector<HTMLElement>('#hud')!.hidden = true;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const p = s.car.position, forward = s.car.forward.clone().setY(0).normalize();
    const right = forward.clone().cross(layer.position.clone().set(0, 1, 0)).normalize();
    const centre = p.clone().addScaledVector(forward, 11);
    layer.addTile('surface-gallery', [
      { kind: 'popper', position: centre.clone().addScaledVector(right, -3).setY(p.y + 1.8).toArray(),
        scale: [2.2, 1.8, 2.2], yaw: 0 },
      { kind: 'burst', position: centre.clone().setY(p.y + 1.8).toArray(),
        scale: [2.2, 1.8, 2.2], yaw: 0 },
      { kind: 'slick', position: centre.clone().addScaledVector(right, 3).setY(p.y + 1.44).toArray(),
        scale: [1.75, 1.44, 1.75], yaw: 0 },
    ]);
    s.racers[0].chase.update = () => {
      camera.position.copy(p).addScaledVector(forward, -3)
        .addScaledVector(layer.position.clone().set(0, 1, 0), 4);
      camera.lookAt(centre); camera.fov = 48; camera.updateProjectionMatrix();
    };
    s.world.render();
    const material = layer.material.fragmentShader as string;
    return { vertices: layer.mesh.geometry.getAttribute('position').count,
      noRedBurstBody: !material.includes('vec3(0.44, 0.008, 0.014)'),
      dropletOpacity: layer.fragmentMesh.material.opacity };
  });
  expect(report.vertices).toBeGreaterThan(700);
  expect(report.noRedBurstBody).toBe(true);
  expect(report.dropletOpacity).toBeLessThan(.6);
  const baseline = process.env.SR_UPDATE_297_BASELINE === '1' ? '' : readFileSync(baselinePath('slime-overhaul',
    'rainy-night-smooth-green-pure-black-purple-baseline.png')).toString('base64');
  const screenshot = await page.screenshot({ path: resolve(OUT,
    'rainy-night-smooth-green-pure-black-purple.png'),
  clip: { x: 330, y: 160, width: 600, height: 300 } });
  if (process.env.SR_UPDATE_297_BASELINE === '1') {
    // The baseline lives on this machine only (tools/baselines is not in version control): a fresh checkout has no folder yet.
    mkdirSync(baselinePath('slime-overhaul'), { recursive: true });
    writeFileSync(baselinePath('slime-overhaul',
      'rainy-night-smooth-green-pure-black-purple-baseline.png'), screenshot);
    return;
  }
  const ratio = await page.evaluate(async ({ expected, actual }) => {
    const pixels = async (base64: string) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height,
        data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const a = await pixels(expected), b = await pixels(actual);
    if (a.width !== b.width || a.height !== b.height) return 1;
    let changed = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const delta = Math.max(Math.abs(a.data[i]! - b.data[i]!),
        Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!));
      if (delta > 20) changed++;
    }
    return changed / (a.width * a.height);
  }, { expected: baseline, actual: screenshot.toString('base64') });
  // WebGL anti-aliasing moves edge pixels slightly between otherwise identical frames. Three per
  // cent still fails a changed body colour or silhouette while ignoring sub-visible edge shimmer.
  expect(ratio).toBeLessThanOrEqual(.03);
});

test('centre and side-swipe blasts originate at the slime mass centre', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&time=day&vehicle=sedan');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'blast direction');
  const results = [];
  for (const offset of [0, -2, 2]) {
    const result = await page.evaluate(offset => {
      const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
      g.phase = 'paused'; g.autopilot = false; layer.fallingLimit = 0;
      for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
      const i = spline.indexAt(45), p = spline.point(i), t = spline.tangent(i), r = spline.right(i);
      const start = [p[0] + r[0] * offset - t[0] * 3, p[1] + .8,
        p[2] + r[2] * offset - t[2] * 3];
      s.car.reset(start, Math.atan2(-t[0], -t[2])); layer.resetCar(s.car);
      s.car.body.setLinvel({x:t[0]*14,y:0,z:t[2]*14},true);
      const before = layer.stats.feedback.hits.burst;
      layer.addTile(`blast-${offset}`, [{kind:'burst',position:[p[0],p[1]+2.46,p[2]],scale:[3,2.46,3],yaw:0}]);
      for (let n=0;n<45 && layer.stats.feedback.hits.burst===before;n++) {
        s.physics.step(1/60, (dt:number)=>{layer.prepareCar(s.car);s.car.update(dt,{throttle:0,brake:0,steer:0});layer.handleCar(s.car);layer.update(dt);});
      }
      const v=s.car.body.linvel();
      s.racers[0].chase.update=(camera:any)=>{camera.position.set(p[0]-t[0]*12,p[1]+7,p[2]-t[2]*12);camera.lookAt(p[0],p[1]+2,p[2]);};
      return {offset,hit:layer.stats.feedback.hits.burst-before,lateral:v.x*r[0]+v.z*r[2],vertical:v.y};
    },offset);
    expect(result.hit).toBe(1);
    expect(result.vertical).toBeGreaterThan(3);
    results.push(result);
    await page.screenshot({path:resolve(OUT,`blast-offset-${offset}.png`)});
  }
  expect(Math.abs(results[0]!.lateral)).toBeLessThan(.3);
  expect(results[1]!.lateral).toBeLessThan(-.5);
  expect(results[2]!.lateral).toBeGreaterThan(.5);
  writeFileSync(resolve(OUT,'blast-directions.json'),JSON.stringify(results,null,2));
});
