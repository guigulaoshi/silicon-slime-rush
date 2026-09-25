import * as THREE from 'three';
import type { TimeOfDay } from '../track/types';

/**
 * The last step of a frame on desktop high quality: bloom and a colour grade.
 *
 * Without it the scene goes straight to the screen through ACES, which is correct and flat. The grade
 * is what photographs and good real-time scenes do after the render: a little bloom round what is
 * genuinely bright (the sun, lamps, lit windows at night), warm highlights with cooler shadows, a gentle
 * S-curve and saturation, a soft vignette, and a whisper of grain that also dithers away banding in the
 * sky. It costs one HDR target, a three-level blur and one full-screen pass, so it is kept to the
 * quality level a desktop GPU runs; phones draw straight to the screen as before.
 */
export class PostGrade {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private target: THREE.WebGLRenderTarget;
  private readonly blur: THREE.WebGLRenderTarget[] = [];
  private readonly bright: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly grade: THREE.ShaderMaterial;
  private frame = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, time: TimeOfDay) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // Multisampled like the canvas the other qualities draw to. Without it this quality -- the best one --
    // was the only one with no antialiasing: FXAA smooths an edge in one frame but cannot hold a cable or a
    // truss thinner than a pixel still, and far bridges sparkled frame to frame (e2e/far-flicker.spec.ts).
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    for (let i = 0; i < 3; i++) this.blur.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    const vertexShader = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.bright = new THREE.ShaderMaterial({ vertexShader, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: time === 'night' ? .9 : 1.6 } },
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
        void main(){ // four bilinear taps cover the 4x4 texels under a half-resolution pixel
          vec3 c = texture2D(tSrc, vUv + vec2(-.5, -.5) * uTexel).rgb + texture2D(tSrc, vUv + vec2(.5, -.5) * uTexel).rgb
                 + texture2D(tSrc, vUv + vec2(-.5, .5) * uTexel).rgb + texture2D(tSrc, vUv + vec2(.5, .5) * uTexel).rgb;
          c *= .25; float l = dot(c, vec3(.2126, .7152, .0722));
          gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold * 2.5, l), 1.0); }` });
    this.down = new THREE.ShaderMaterial({ vertexShader, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
          c += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
          c += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
          c += (texture2D(tSrc, vUv + vec2(-2.0, 0.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(2.0, 0.0) * uTexel).rgb
              + texture2D(tSrc, vUv + vec2(0.0, -2.0) * uTexel).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0) * uTexel).rgb) * .5;
          gl_FragColor = vec4(c / 10.0, 1.0); }` });
    const night = time === 'night';
    this.grade = new THREE.ShaderMaterial({ vertexShader, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null },
        uExposure: { value: 1.06 }, uBloom: { value: night ? .9 : .45 }, uWarm: { value: night ? 0 : 1 },
        uFrame: { value: 0 }, uAspect: { value: 1 }, uTexel: { value: new THREE.Vector2() } },
      fragmentShader: `uniform sampler2D tScene, tB0, tB1, tB2; uniform float uExposure, uBloom, uWarm, uFrame, uAspect; uniform vec2 uTexel;
        varying vec2 vUv;
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec3 aces(vec3 x){ x *= 0.6; return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0.0, 1.0); }
        vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - .055, step(.0031308, c)); }
        float luma(vec3 c){ return dot(aces(c), vec3(.299, .587, .114)); }
        // A light FXAA: blend along the edge where the local contrast says there is one.
        vec3 fxaa(vec2 uv){
          vec3 m = texture2D(tScene, uv).rgb;
          float lm = luma(m);
          float ln = luma(texture2D(tScene, uv + vec2(0.0, uTexel.y)).rgb), ls = luma(texture2D(tScene, uv - vec2(0.0, uTexel.y)).rgb);
          float le = luma(texture2D(tScene, uv + vec2(uTexel.x, 0.0)).rgb), lw = luma(texture2D(tScene, uv - vec2(uTexel.x, 0.0)).rgb);
          float lo = min(lm, min(min(ln, ls), min(le, lw))), hi = max(lm, max(max(ln, ls), max(le, lw)));
          if (hi - lo < max(.04, hi * .12)) return m;
          vec2 dir = normalize(vec2(-((ln + ls) - (le + lw)), (le + lw) - (ln + ls)) + 1e-5) * uTexel;
          vec3 a = .5 * (texture2D(tScene, uv - dir * .5).rgb + texture2D(tScene, uv + dir * .5).rgb);
          return mix(m, a, .75);
        }
        void main(){
          vec3 col = fxaa(vUv);
          col += (texture2D(tB0, vUv).rgb * .5 + texture2D(tB1, vUv).rgb * .3 + texture2D(tB2, vUv).rgb * .2) * uBloom;
          col *= uExposure;
          float lum = dot(col, vec3(.2126, .7152, .0722));
          // warm highlights, cool shadows: a white balance a photograph of a sunny afternoon has
          col = mix(col, col * vec3(1.04, 1.0, .93), smoothstep(.08, .9, lum) * uWarm);
          col = mix(col, col * vec3(.93, 1.0, 1.06), 1.0 - smoothstep(0.0, .14, lum));
          vec3 m = aces(col);
          float l = dot(m, vec3(.299, .587, .114));
          m = mix(vec3(l), m, 1.03);                                   // a touch of saturation
          m = clamp(m, 0.0, 1.0);
          m = mix(m, m * m * (3.0 - 2.0 * m), .12);                     // gentle S-curve
          vec2 cc = (vUv - .5) * vec2(uAspect, 1.0);
          m *= mix(.90, 1.0, 1.0 - smoothstep(.55, 1.25, length(cc)));  // soft vignette
          m = toSRGB(clamp(m, 0.0, 1.0));
          float g = hash12(gl_FragCoord.xy + fract(uFrame * .618) * 311.0) - .5;
          m += g * .012 + (hash12(gl_FragCoord.yx * 1.3 + uFrame) - .5) / 255.0;   // grain + dither
          gl_FragColor = vec4(m, 1.0);
        }` });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.grade);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Where the frame is drawn before grading; the caller renders every viewport into it. */
  begin(): THREE.WebGLRenderTarget {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) this.target.setSize(size.x, size.y);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setRenderTarget(this.target);
    return this.target;
  }

  /** Bloom and grade the frame onto the screen. */
  end(): void {
    const r = this.renderer;
    const w = this.target.width, h = this.target.height;
    let src: THREE.Texture = this.target.texture;
    for (let i = 0; i < this.blur.length; i++) {
      const rt = this.blur[i]!;
      const bw = Math.max(1, w >> (i + 1)), bh = Math.max(1, h >> (i + 1));
      if (rt.width !== bw || rt.height !== bh) rt.setSize(bw, bh);
      const mat = i === 0 ? this.bright : this.down;
      mat.uniforms.tSrc!.value = src;
      mat.uniforms.uTexel!.value.set(1 / Math.max(1, w >> i), 1 / Math.max(1, h >> i));
      this.quad.material = mat;
      r.setRenderTarget(rt);
      r.render(this.scene, this.camera);
      src = rt.texture;
    }
    const u = this.grade.uniforms;
    u.tScene!.value = this.target.texture;
    u.tB0!.value = this.blur[0]!.texture; u.tB1!.value = this.blur[1]!.texture; u.tB2!.value = this.blur[2]!.texture;
    u.uFrame!.value = this.frame++;
    u.uAspect!.value = w / h;
    u.uTexel!.value.set(1 / w, 1 / h);
    this.quad.material = this.grade;
    r.setRenderTarget(null);
    r.setViewport(0, 0, r.domElement.clientWidth, r.domElement.clientHeight);
    r.render(this.scene, this.camera);
    r.toneMapping = THREE.ACESFilmicToneMapping;
  }

  dispose(): void {
    this.target.dispose();
    this.blur.forEach(rt => rt.dispose());
    this.quad.geometry.dispose();
    [this.bright, this.down, this.grade].forEach(m => m.dispose());
  }
}
