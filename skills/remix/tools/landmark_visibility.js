// 每个地标在跟车画面里实际能看见多少米路 —— 验收「开到跟前」的地标用它量，不凭感觉。
//
// 离路线多近、偏角多少都会骗人：偏角对了，街两边的楼照样把它挡住；按外框中心打射线，摊在山脊上的
// 一大片矮墙会被判成看不见。这里从路线上每隔 `step` 米的跟车机位（车后 5 米、离地 2.6 米）朝
// 模型本身的顶点随机取 24 个点打射线：点在横向半视野 `half` 度以内、而且射线最先打中的就是这个地标，
// 才算看见；一站至少看见 2 个点，这一站算「看得见」。
//
// 用法：开发模式打开一条赛道（`?track=<id>&dev=1&bot=1`），在浏览器里执行这个文件的全部内容，然后
//   await srLandmarkVisibility.all()     // [[地标, 看得见的米数, "起-止@距离 ..."], ...]
// 浏览器面板在后台时计时器会被降速，一次调用可能超时：先 `srLandmarkVisibility.start()`，
// 再反复 `srLandmarkVisibility.result()` 取结果。
// 读的是原作开发模式挂在 window.game 上的 session.world（spline、scene）；换皮没动过这一层就能直接用。
// 同一个页面执行两遍也没事：它不改任何渲染函数（改渲染函数的验收脚本装两遍会无限递归，画面卡死）。
(() => {
  const three = () => import('/node_modules/.vite/deps/three.js');
  const world = () => window.game.session.world;

  async function landmarkIds() {
    const track = new URLSearchParams(location.search).get('track');
    const doc = await (await fetch(`/tracks/${track}/track.json`)).json();
    return (doc.landmarks ?? []).map(l => l.id ?? l.name ?? l).filter(id => world().scene.getObjectByName(id));
  }

  async function measure(id, { step = 50, half = 36, samples = 24 } = {}) {
    const T = await three();
    const w = world();
    const lm = w.scene.getObjectByName(id);
    lm.updateMatrixWorld(true);
    const own = new Set(), points = [];
    lm.traverse(o => {
      own.add(o);
      const pos = o.isMesh && o.geometry?.attributes?.position;
      if (!pos) return;
      for (let k = 0; k < 6; k++) points.push(new T.Vector3().fromBufferAttribute(pos, Math.floor(Math.random() * pos.count)).applyMatrix4(o.matrixWorld));
    });
    const targets = points.sort(() => Math.random() - 0.5).slice(0, samples);
    const scene = w.scene.children.filter(o => !/sky|mist/i.test(o.name));
    const ray = new T.Raycaster();
    const rows = [];
    for (let s = 0; s < w.spline.length; s += step) {
      const i = w.spline.indexAt(s), p = w.spline.point(i), t = w.spline.tangent(i);
      const eye = new T.Vector3(p[0] - t[0] * 5, p[1] + 2.6, p[2] - t[2] * 5);
      let seen = 0, dist = 0;
      for (const q of targets) {
        const dx = q.x - eye.x, dz = q.z - eye.z;
        if (Math.abs(Math.atan2(t[0] * dz - t[2] * dx, t[0] * dx + t[2] * dz)) * 180 / Math.PI > half) continue;
        const dir = q.clone().sub(eye), length = dir.length();
        ray.set(eye, dir.normalize()); ray.far = length + 0.5;
        const hit = ray.intersectObjects(scene, true).find(h => h.object.visible && !/checkpoint|slime|gate/i.test(h.object.name));
        if (hit && own.has(hit.object)) { seen++; dist = Math.round(length); }
      }
      rows.push([s, seen, dist]);
      if (rows.length % 8 === 0) await new Promise(r => setTimeout(r, 0));   // let the page breathe
    }
    const spans = [];
    let cur = null;
    for (const [s, seen, d] of rows) {
      if (seen >= 2) { cur ??= [s, s, d]; cur[1] = s; } else if (cur) { spans.push(cur); cur = null; }
    }
    if (cur) spans.push(cur);
    return [id, spans.reduce((a, x) => a + x[1] - x[0] + step, 0), spans.map(x => `${x[0]}-${x[1]}@${x[2]}m`).join(' ')];
  }

  let running = null;
  window.srLandmarkVisibility = {
    measure,
    async all(options) { const out = []; for (const id of await landmarkIds()) out.push(await measure(id, options)); return out; },
    start(options) { running = { done: false, out: null }; const job = running; this.all(options).then(out => { job.out = out; job.done = true; }); return 'started'; },
    result() { return running?.done ? running.out : 'running'; },
  };
  return 'srLandmarkVisibility ready';
})();
