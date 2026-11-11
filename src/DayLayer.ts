import { BufferAttribute, BufferGeometry, Camera, Color, Group, LineSegments, Matrix4, Object3D, Points, Scene, ShaderMaterial, WebGLRenderer, type IUniform, type Material, type Mesh } from 'three'
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl'
import { ARC_HOURS, type Arc } from './replay'

const SEGMENTS = 28
const GREEN = new Color('#0b7a6b')
const RED = new Color('#c9382c')

/** How long a pulse lasts, in simulated hours. */
const PULSE_HOURS = 0.9

const merc = (lon: number, lat: number) => maplibregl.MercatorCoordinate.fromLngLat({ lng: lon, lat })

const COMMON = /* glsl */ `
  uniform mat4 uMatrix;
  uniform float uHour;
  uniform float uDur;
  uniform float uPx;
  attribute vec2 aTo;
  attribute float aStart;
  attribute float aKind;
  attribute vec2 aBow;
  attribute float aLift;
  varying float vA;
  varying float vKind;
  vec3 along(vec2 from, float t) {
    float arch = 4.0 * t * (1.0 - t);
    return vec3(mix(from, aTo, t) + aBow * arch, aLift * arch);
  }
`

const ARC_VERT = /* glsl */ `${COMMON}
  attribute vec2 aFrom;
  void main() {
    float t = position.x;
    float p = clamp((uHour - aStart) / uDur, 0.0, 1.0);
    float moving = (p > 0.0 && p < 1.0) ? 1.0 : 0.0;
    float visible = (p > 0.0 && t <= p) ? 1.0 : 0.0;
    vA = visible * mix(0.5, 1.0, moving * smoothstep(p - 0.4, p, t));
    vKind = aKind;
    gl_Position = uMatrix * vec4(along(aFrom, t), 1.0);
  }
`

const PACKET_VERT = /* glsl */ `${COMMON}
  void main() {
    float p = clamp((uHour - aStart) / uDur, 0.0, 1.0);
    bool on = p > 0.0 && p < 1.0;
    vA = on ? 1.0 : 0.0;
    vKind = aKind;
    gl_PointSize = on ? 7.0 * uPx : 0.0;
    gl_Position = uMatrix * vec4(along(position.xy, p), 1.0);
  }
`

const PULSE_VERT = /* glsl */ `${COMMON}
  uniform float uPulse;
  void main() {
    float age = (uHour - aStart) / uPulse;
    bool on = age >= 0.0 && age < 1.0;
    vA = on ? (1.0 - age) : 0.0;
    vKind = aKind;
    gl_PointSize = on ? mix(10.0, 46.0, 1.0 - pow(1.0 - age, 2.0)) * uPx : 0.0;
    gl_Position = uMatrix * vec4(position.xy, 0.0, 1.0);
  }
`

const colorFrag = (shape: string) => /* glsl */ `
  uniform vec3 uGreen;
  uniform vec3 uRed;
  varying float vA;
  varying float vKind;
  void main() {
    ${shape}
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uRed, uGreen, vKind), a);
  }
`
const LINE_FRAG = colorFrag('float a = vA * 0.85;')
const DOT_FRAG = colorFrag('float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.8, 1.0, d)) * vA;')
const RING_FRAG = colorFrag('float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(0.62, 0.8, d) * (1.0 - smoothstep(0.88, 1.0, d)) * vA;')

function material(vertexShader: string, fragmentShader: string, uniforms: Record<string, IUniform>) {
  return new ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uGreen: { value: GREEN }, uRed: { value: RED }, ...uniforms },
  })
}

/**
 * The day replay, drawn with three.js inside the map's own WebGL context: a pulse where each package fails
 * and an arc to the van (green) or the CEDI (red). It only reveals what `simulate` already decided; nothing here
 * changes a result. Arcs are straight-line illustrations, not routes.
 */
export class DayLayer implements CustomLayerInterface {
  id = 'day'
  type = 'custom' as const
  renderingMode = '2d' as const

  private map?: MapLibreMap
  private renderer?: WebGLRenderer
  private scene = new Scene()
  private camera = new Camera()
  private group = new Group()
  private origin = new Matrix4()
  private uniforms = {
    uMatrix: { value: new Matrix4() },
    uHour: { value: 100 },
    uDur: { value: ARC_HOURS },
    uPulse: { value: PULSE_HOURS },
    uPx: { value: 1 },
  }
  private data: { arcs: Arc[]; showArcs: boolean } = { arcs: [], showArcs: true }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
    this.renderer.autoClear = false
    this.uniforms.uPx.value = window.devicePixelRatio || 1
    this.scene.add(this.group)
    this.build()
  }

  onRemove() {
    this.clear()
    this.renderer?.dispose()
    this.renderer = undefined
    this.map = undefined
  }

  /** Arcs and pulses for one simulated day. `reduced` makes arcs appear whole, with no travel animation. */
  setData(arcs: Arc[], showArcs: boolean, reduced: boolean) {
    this.data = { arcs, showArcs }
    this.uniforms.uDur.value = reduced ? 0.001 : ARC_HOURS
    this.uniforms.uPulse.value = reduced ? 0.25 : PULSE_HOURS
    if (this.renderer) this.build()
  }

  setHour(hour: number) {
    this.uniforms.uHour.value = hour
    this.map?.triggerRepaint()
  }

  private clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o)
      const m = o as Mesh
      m.geometry?.dispose()
      ;(m.material as Material)?.dispose()
    }
  }

  private build() {
    this.clear()
    const { arcs, showArcs } = this.data
    if (!arcs.length) return
    // Positions are stored relative to the first point: float32 would otherwise jitter at street zoom.
    const o = merc(arcs[0].from[0], arcs[0].from[1])
    this.origin.makeTranslation(o.x, o.y, 0)
    const rel = (lon: number, lat: number): [number, number] => { const c = merc(lon, lat); return [c.x - o.x, c.y - o.y] }

    const n = arcs.length
    const per = {
      to: new Float32Array(n * 2), start: new Float32Array(n), kind: new Float32Array(n),
      bow: new Float32Array(n * 2), lift: new Float32Array(n), from: new Float32Array(n * 3),
    }
    arcs.forEach((a, i) => {
      const f = rel(a.from[0], a.from[1])
      const t = rel(a.to[0], a.to[1])
      const dx = t[0] - f[0]
      const dy = t[1] - f[1]
      per.from.set([f[0], f[1], 0], i * 3)
      per.to.set(t, i * 2)
      per.start[i] = a.hour
      per.kind[i] = a.saved ? 1 : 0
      // The bow sideways keeps the arc curved even with the map seen from above; the lift shows when it is tilted.
      per.bow.set([-dy * 0.16, dx * 0.16], i * 2)
      per.lift[i] = Math.hypot(dx, dy) * 0.22
    })

    const pulses = new BufferGeometry()
    pulses.setAttribute('position', new BufferAttribute(per.from, 3))
    pulses.setAttribute('aStart', new BufferAttribute(per.start, 1))
    pulses.setAttribute('aKind', new BufferAttribute(new Float32Array(n), 1)) // pulses are always the failure colour
    pulses.setAttribute('aTo', new BufferAttribute(per.to, 2))
    pulses.setAttribute('aBow', new BufferAttribute(per.bow, 2))
    pulses.setAttribute('aLift', new BufferAttribute(per.lift, 1))
    const add = (obj: Object3D, order: number) => { obj.frustumCulled = false; obj.renderOrder = order; this.group.add(obj) }
    add(new Points(pulses, material(PULSE_VERT, RING_FRAG, this.uniforms)), 0)
    if (!showArcs) return

    const packets = new BufferGeometry()
    packets.setAttribute('position', new BufferAttribute(per.from, 3))
    packets.setAttribute('aStart', new BufferAttribute(per.start, 1))
    packets.setAttribute('aKind', new BufferAttribute(per.kind, 1))
    packets.setAttribute('aTo', new BufferAttribute(per.to, 2))
    packets.setAttribute('aBow', new BufferAttribute(per.bow, 2))
    packets.setAttribute('aLift', new BufferAttribute(per.lift, 1))

    // One LineSegments for every arc: 2 vertices per segment, `position.x` is the 0..1 place along the arc.
    const verts = n * SEGMENTS * 2
    const pos = new Float32Array(verts * 3)
    const attrs = { from: new Float32Array(verts * 2), to: new Float32Array(verts * 2), start: new Float32Array(verts), kind: new Float32Array(verts), bow: new Float32Array(verts * 2), lift: new Float32Array(verts) }
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < SEGMENTS; s++) {
        for (let e = 0; e < 2; e++) {
          const v = (i * SEGMENTS + s) * 2 + e
          pos[v * 3] = (s + e) / SEGMENTS
          attrs.from.set([per.from[i * 3], per.from[i * 3 + 1]], v * 2)
          attrs.to.set([per.to[i * 2], per.to[i * 2 + 1]], v * 2)
          attrs.start[v] = per.start[i]
          attrs.kind[v] = per.kind[i]
          attrs.bow.set([per.bow[i * 2], per.bow[i * 2 + 1]], v * 2)
          attrs.lift[v] = per.lift[i]
        }
      }
    }
    const lines = new BufferGeometry()
    lines.setAttribute('position', new BufferAttribute(pos, 3))
    lines.setAttribute('aFrom', new BufferAttribute(attrs.from, 2))
    lines.setAttribute('aTo', new BufferAttribute(attrs.to, 2))
    lines.setAttribute('aStart', new BufferAttribute(attrs.start, 1))
    lines.setAttribute('aKind', new BufferAttribute(attrs.kind, 1))
    lines.setAttribute('aBow', new BufferAttribute(attrs.bow, 2))
    lines.setAttribute('aLift', new BufferAttribute(attrs.lift, 1))
    add(new LineSegments(lines, material(ARC_VERT, LINE_FRAG, this.uniforms)), 1)
    add(new Points(packets, material(PACKET_VERT, DOT_FRAG, this.uniforms)), 2)
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.renderer || !this.group.children.length) return
    this.uniforms.uMatrix.value.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]).multiply(this.origin)
    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
  }
}
