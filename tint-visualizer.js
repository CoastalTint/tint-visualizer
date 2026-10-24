/*!
 * Coastal Tint – Window Tint Visualizer
 * Mounts into <div id="ct-tint-visualizer" data-asset-base="https://host/path/models/"></div>
 * Load with: <script type="module" src="https://host/path/tint-visualizer.js"></script>
 * three.js r170 is loaded on demand from jsDelivr (pinned). No inline JS is needed on the page.
 * Optional data attributes on the mount div:
 *   data-asset-base   folder that holds sedan.glb … van.glb (default: ./models/ next to this file)
 *   data-quote-url    CTA link (default: /contact/)
 *   data-autorotate   "false" to disable the idle turntable spin
 */
const THREE_VER = '0.170.0';
const CDN = 'https://cdn.jsdelivr.net/npm/three@' + THREE_VER;
const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const ROOT_ID = 'ct-tint-visualizer';

const BODIES = [
  { key: 'sedan', label: 'Sedan' },
  { key: 'coupe', label: 'Coupe' },
  { key: 'hatchback', label: 'Hatchback' },
  { key: 'suv', label: 'SUV' },
  { key: 'truck', label: 'Truck' },
  { key: 'van', label: 'Van' },
];
const BODY_LABEL = Object.fromEntries(BODIES.map((b) => [b.key, b.label]));

// Pane names are matched exactly (e.g. glass_back_gasket is trim, not glass).
const GROUPS = {
  windshield: ['glass_windshield'],
  front: ['glass_front_left', 'glass_front_right'],
  rear: ['glass_rear_left', 'glass_rear_right', 'glass_quarter_left', 'glass_quarter_right'],
  back: ['glass_back'],
  sunroof: ['glass_sunroof'],
};
const GROUP_KEYS = Object.keys(GROUPS);
const ALL_PANES = [].concat(...Object.values(GROUPS));
const GROUP_LABEL = { all: 'All windows', windshield: 'Windshield', front: 'Front sides', rear: 'Rear sides', back: 'Back glass', sunroof: 'Sunroof' };
const PRESETS = [5, 15, 20, 35, 50, 70];
const VLT_MIN = 5, VLT_MAX = 90, CLEAR_VLT = 88, DEFAULT_VLT = 35;
const STRIP_FRACTION = 0.13; // top share of the windshield height used for the visor strip

const POPULAR_MAKES = ['Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Ford', 'Genesis', 'GMC',
  'Honda', 'Hyundai', 'Infiniti', 'Jeep', 'Kia', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan',
  'Porsche', 'Ram', 'Rivian', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'];

/* ------------------------------------------------------------------ vPIC */
const vpicCache = new Map();
function vpic(path) {
  if (vpicCache.has(path)) return vpicCache.get(path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  const url = VPIC + '/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'format=json';
  const p = fetch(url, { signal: ctrl.signal })
    .then((r) => { if (!r.ok) throw new Error('vPIC HTTP ' + r.status); return r.json(); })
    .then((j) => j.Results || [])
    .finally(() => clearTimeout(timer));
  vpicCache.set(path, p);
  p.catch(() => vpicCache.delete(path));
  return p;
}
const VTYPES = { car: 'passenger car', mpv: 'multipurpose passenger vehicle (mpv)', truck: 'truck' };
const pretty = (n) => n.toLowerCase().replace(/(^|[\s\-\/])([a-z])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\bBmw\b/, 'BMW').replace(/\bGmc\b/, 'GMC').replace(/\bMini\b/, 'Mini');

async function getMakes() {
  const lists = await Promise.all(Object.values(VTYPES).map((t) => vpic('GetMakesForVehicleType/' + encodeURIComponent(t))));
  const map = new Map();
  for (const l of lists) for (const m of l) { const n = (m.MakeName || '').trim(); if (n) map.set(n.toUpperCase(), pretty(n)); }
  return [...map.values()].sort((a, b) => a.localeCompare(b));
}
async function getModels(make, year) {
  const mk = encodeURIComponent(make.toLowerCase());
  let failures = 0;
  const lists = await Promise.all(Object.entries(VTYPES).map(([k, t]) =>
    vpic('GetModelsForMakeYear/make/' + mk + '/modelyear/' + year + '/vehicletype/' + encodeURIComponent(t))
      .then((r) => r.map((x) => ({ name: String(x.Model_Name).trim(), vtype: k })))
      .catch(() => { failures++; return []; })));
  if (failures === lists.length) throw new Error('vPIC unreachable');
  const byName = new Map();
  for (const l of lists) for (const x of l) {
    const prev = byName.get(x.name);
    if (!prev) byName.set(x.name, x); else if (!prev.vtypes) prev.vtypes = [prev.vtype, x.vtype]; else prev.vtypes.push(x.vtype);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
async function decodeVin(vin) { const r = await vpic('DecodeVinValues/' + encodeURIComponent(vin)); return r[0] || null; }

const words = (list) => new RegExp('(^|[^a-z0-9])(' + list.join('|') + ')([^a-z0-9]|$)', 'i');
const RX_VAN = words(['transit', 'express', 'savana', 'sprinter', 'promaster', 'nv\\d*', 'e-series', 'econoline', 'metris',
  'city express', 'van', 'transit connect', 'astro', 'safari', 'id\\.? ?buzz']);
const RX_MINIVAN = words(['odyssey', 'sienna', 'pacifica', 'carnival', 'sedona', 'caravan', 'grand caravan', 'town (and|&) country',
  'quest', 'voyager', 'routan', 'previa', 'entourage', 'uplander', 'montana', 'freestar', 'windstar', 'mazda5', 'mazda 5', 'mpv']);
const RX_COUPE = words(['mustang', 'camaro', 'corvette', 'challenger', 'brz', '86', 'gr86', 'fr-s', 'supra', 'gr supra', 'mx-5',
  'miata', '370z', '350z', 'z', 'rc', 'rc f', 'lc', '911', '718', 'cayman', 'boxster', 'tt', 'r8', 'genesis coupe', 's2000',
  'viper', 'solstice', 'sky', 'm2', 'm4', 'm8', '2 series', '4 series', '8 series', 'z4', 'f-type', 'sl', 'slk', 'slc',
  'amg gt', 'gt-r', 'nsx', 'q60', 'tc', 'eclipse', 'crossfire', 'cr-z', 'coupe', 'convertible', 'cabrio(let)?',
  'roadster', 'spider', 'spyder']);
const RX_HATCH = words(['fit', 'golf', 'gti', 'golf r', 'e-golf', 'bolt', 'bolt ev', 'leaf', 'prius', 'prius c', 'prius prime',
  'versa note', 'spark', 'sonic', 'mirage', 'veloster', 'hardtop', 'cooper', 'clubman', '500', '500e', 'fiesta', 'i3',
  'elantra gt', 'rio 5-door', 'soul', 'cube', 'xb', 'matrix', 'vibe', 'c-max', 'ioniq', 'gr corolla', 'corolla im', 'im',
  'polestar 2', 'beetle', 'type r', 'model 3 hatch', 'hatch(back)?', 'sportback', 'liftback', '5-door']);
const RX_WAGON = words(['wagon', 'sportwagen', 'alltrack', 'outback', 'v60', 'v90', 'estate', 'avant', 'touring']);
const RX_XOVER = words(['c-hr', 'crosstrek', 'kona', 'niro', 'juke', 'hr-v', 'kicks', 'encore', 'trax', 'venue', 'seltos']);
const RX_MULTI = words(['civic', 'corolla', 'impreza', 'mazda3', '3', 'elantra', 'focus', 'cruze', 'accent', 'rio', 'yaris',
  'a3', 'a5', 'integra', 'golf']);

/** Body class for a year/make/model pick. vPIC's model list gives a vehicle type (car / MPV / truck);
 *  the model name refines it into a vPIC-style BodyClass string. VIN decode gives the real BodyClass. */
function inferBodyClass(model, vtype) {
  const n = model.toLowerCase();
  const types = model.vtypes || [vtype];
  if (vtype === 'truck' || types.includes('truck')) {
    if (RX_MINIVAN.test(n)) return { bodyClass: 'Minivan', why: 'vPIC type Truck, minivan model' };
    if (RX_VAN.test(n)) return { bodyClass: 'Van', why: 'vPIC type Truck, van model' };
    if (vtype === 'truck') return { bodyClass: 'Pickup', why: 'vPIC type Truck' };
  }
  if (vtype === 'mpv') {
    if (RX_MINIVAN.test(n)) return { bodyClass: 'Minivan', why: 'vPIC type MPV, minivan model' };
    if (RX_VAN.test(n)) return { bodyClass: 'Van', why: 'vPIC type MPV, van model' };
    return { bodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)', why: 'vPIC type MPV (SUV / crossover)' };
  }
  if (vtype === 'car') {
    if (/convertible|cabrio|roadster|spyder|spider/.test(n)) return { bodyClass: 'Convertible/Cabriolet', why: 'vPIC type Passenger Car, convertible model' };
    if (/coupe/.test(n)) return { bodyClass: 'Coupe', why: 'vPIC type Passenger Car, coupe model' };
    if (RX_WAGON.test(n)) return { bodyClass: 'Wagon', why: 'vPIC type Passenger Car, wagon model' };
    if (/hatch/.test(n)) return { bodyClass: 'Hatchback/Liftback/Notchback', why: 'vPIC type Passenger Car, hatchback model' };
    if (RX_XOVER.test(n)) return { bodyClass: 'Crossover Utility Vehicle (CUV)', why: 'vPIC type Passenger Car, crossover model' };
    if (RX_COUPE.test(n)) return { bodyClass: 'Coupe', why: 'vPIC type Passenger Car, coupe model' };
    if (RX_HATCH.test(n)) return { bodyClass: 'Hatchback/Liftback/Notchback', why: 'vPIC type Passenger Car, hatchback model' };
    return { bodyClass: 'Sedan/Saloon', why: 'vPIC type Passenger Car' };
  }
  return { bodyClass: '', why: 'body style unknown' };
}

/** vPIC BodyClass -> one of the 6 GLBs. */
function bodyFromBodyClass(bc) {
  const b = String(bc || '').toLowerCase();
  if (!b) return 'sedan';
  if (b.includes('pickup') || b.includes('sport utility truck')) return 'truck';
  if (b.includes('van')) return 'van';                                   // Minivan, Van, Cargo Van
  if (b.includes('sport utility') || b.includes('suv') || b.includes('crossover') || b.includes('cuv') ||
      b.includes('multi-purpose') || b.includes('mpv')) return 'suv';
  if (b.includes('convertible') || b.includes('cabriolet') || b.includes('coupe') || b.includes('roadster')) return 'coupe';
  if (b.includes('hatchback') || b.includes('liftback') || b.includes('wagon')) return 'hatchback';
  return 'sedan';
}

/* ------------------------------------------------------------------ helpers */
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const clampVLT = (v) => Math.max(VLT_MIN, Math.min(VLT_MAX, Math.round(+v || DEFAULT_VLT)));

function ensureCss() {
  const probe = document.getElementById(ROOT_ID);
  if (probe && getComputedStyle(probe).getPropertyValue('--ctv-css').trim()) return;
  if (document.querySelector('link[data-ctv-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('tint-visualizer.css', import.meta.url).href; link.setAttribute('data-ctv-css', '');
  document.head.append(link);
}

/* ------------------------------------------------------------------ app */
function mount(root) {
  if (root.__ctv) return root.__ctv;
  ensureCss();
  let assetBase = root.getAttribute('data-asset-base') || new URL('models/', import.meta.url).href;
  if (assetBase.slice(-1) !== '/') assetBase += '/';
  const quoteUrl = root.getAttribute('data-quote-url') || '/contact/';
  const autoRotate = root.getAttribute('data-autorotate') !== 'false';

  const state = {
    body: 'sedan', group: 'all', windshieldMode: 'strip',
    vlt: { windshield: DEFAULT_VLT, front: DEFAULT_VLT, rear: DEFAULT_VLT, back: DEFAULT_VLT, sunroof: DEFAULT_VLT },
    year: '', make: '', model: '', bodyClass: '', bodySource: 'default',
  };

  /* ---------- DOM ---------- */
  root.classList.add('ctv-root');
  root.textContent = '';
  const stage = h('div', { class: 'ctv-stage', role: 'img', 'aria-label': '3D vehicle preview. Drag to rotate.' });
  const vehLabel = h('div', { class: 'ctv-veh' }, 'Sedan');
  const vehNote = h('div', { class: 'ctv-veh-note' });
  const loaderText = h('span', { class: 'ctv-loader-text' }, 'Loading 3D viewer…');
  const loader = h('div', { class: 'ctv-loader', 'aria-live': 'polite' }, h('span', { class: 'ctv-spinner', 'aria-hidden': 'true' }), loaderText);
  const hint = h('div', { class: 'ctv-hint' }, 'Drag to rotate 360° · pinch or scroll to zoom');
  const resetBtn = h('button', { type: 'button', class: 'ctv-btn ctv-reset' }, 'Reset view');
  stage.append(h('div', { class: 'ctv-veh-wrap', 'aria-live': 'polite' }, vehLabel, vehNote), loader, hint, resetBtn);

  const cta = h('a', { class: 'ctv-cta', href: quoteUrl }, 'Get a quote');

  // vehicle section
  const yearSel = h('select', { class: 'ctv-select', 'aria-label': 'Year' });
  const makeSel = h('select', { class: 'ctv-select', 'aria-label': 'Make', disabled: true });
  const modelSel = h('select', { class: 'ctv-select', 'aria-label': 'Model', disabled: true });
  yearSel.append(h('option', { value: '' }, 'Year'));
  const nowY = new Date().getFullYear();
  for (let y = nowY + 1; y >= 1990; y--) yearSel.append(h('option', { value: String(y) }, String(y)));
  makeSel.append(h('option', { value: '' }, 'Make'));
  modelSel.append(h('option', { value: '' }, 'Model'));
  const status = h('div', { class: 'ctv-status', role: 'status' });
  const bodyBtns = {};
  const bodyRow = h('div', { class: 'ctv-pills', role: 'group', 'aria-label': 'Body type' },
    BODIES.map((b) => (bodyBtns[b.key] = h('button', { type: 'button', class: 'ctv-pill', 'aria-pressed': 'false', 'data-body': b.key,
      onclick: () => { state.bodySource = 'manual'; setBody(b.key); updateBodyNote(); } }, b.label))));
  const bodyNote = h('div', { class: 'ctv-small' });
  const vinInput = h('input', { type: 'text', class: 'ctv-input', maxlength: '17', autocomplete: 'off', spellcheck: 'false', placeholder: '17-character VIN', 'aria-label': 'VIN' });
  const vinMsg = h('div', { class: 'ctv-small' });
  const vinBtn = h('button', { type: 'button', class: 'ctv-btn' }, 'Look up');
  const vinBox = h('details', { class: 'ctv-vin' }, h('summary', null, 'Have your VIN? Find the exact body style'),
    h('div', { class: 'ctv-vin-row' }, vinInput, vinBtn), vinMsg);

  // tint section
  const groupBtns = {};
  const groupRow = h('div', { class: 'ctv-tabs', role: 'tablist', 'aria-label': 'Windows' },
    ['all'].concat(GROUP_KEYS).map((g) => (groupBtns[g] = h('button', { type: 'button', role: 'tab', class: 'ctv-tab', 'data-group': g,
      'aria-selected': 'false', onclick: () => selectGroup(g) }, GROUP_LABEL[g], h('span', { class: 'ctv-tab-v' })))));
  const sliderId = 'ctv-vlt-' + Math.random().toString(36).slice(2, 7);
  const slider = h('input', { type: 'range', id: sliderId, class: 'ctv-range', min: String(VLT_MIN), max: String(VLT_MAX), step: '1', value: String(DEFAULT_VLT) });
  const vltOut = h('output', { class: 'ctv-vlt-out', for: sliderId }, DEFAULT_VLT + '%');
  const groupName = h('span', null, 'All windows');
  const presetBtns = PRESETS.map((v) => h('button', { type: 'button', class: 'ctv-preset', 'data-vlt': String(v), 'aria-pressed': 'false',
    style: '--ctv-shade:' + (1 - v / 100).toFixed(2), onclick: () => setTint(state.group, v) },
  h('span', { class: 'ctv-sw', 'aria-hidden': 'true' }), v + '%'));
  const wsModeBtns = {};
  const wsRow = h('div', { class: 'ctv-wsmode', role: 'group', 'aria-label': 'Windshield coverage' },
    h('span', { class: 'ctv-small' }, 'Windshield:'),
    [['strip', 'Top strip'], ['full', 'Full'], ['none', 'Clear']].map(([k, l]) => (wsModeBtns[k] = h('button', { type: 'button', class: 'ctv-pill ctv-pill-sm',
      'aria-pressed': 'false', 'data-wsmode': k, onclick: () => setWindshieldMode(k) }, l))));
  const legal = h('p', { class: 'ctv-note' }, 'California limits tint on the windshield and front side windows. Check current CA law, or ask us what fits your vehicle.');

  const panel = h('div', { class: 'ctv-panel' },
    h('section', { class: 'ctv-sec' }, h('h3', { class: 'ctv-h' }, '1 · Your vehicle'),
      h('div', { class: 'ctv-fields' }, h('label', { class: 'ctv-field' }, h('span', null, 'Year'), yearSel),
        h('label', { class: 'ctv-field' }, h('span', null, 'Make'), makeSel),
        h('label', { class: 'ctv-field ctv-full' }, h('span', null, 'Model'), modelSel)),
      status,
      h('div', { class: 'ctv-field' }, h('span', null, 'Body type shown'), bodyRow), bodyNote, vinBox),
    h('section', { class: 'ctv-sec' }, h('h3', { class: 'ctv-h' }, '2 · Tint shade (VLT)'),
      groupRow,
      h('div', { class: 'ctv-vlt-row' }, h('label', { for: sliderId }, groupName), vltOut),
      slider,
      h('div', { class: 'ctv-presets', role: 'group', 'aria-label': 'Preset shades' }, presetBtns),
      wsRow,
      h('p', { class: 'ctv-small' }, 'VLT = visible light transmission. Lower % = darker.'),
      legal));

  root.append(
    h('div', { class: 'ctv-head' }, h('div', { class: 'ctv-brand' }, 'Coastal ', h('span', null, 'Tint')), h('div', { class: 'ctv-title' }, 'Window Tint Visualizer')),
    h('div', { class: 'ctv-grid' }, h('div', { class: 'ctv-main' }, stage, cta), panel),
    h('p', { class: 'ctv-foot' }, 'Generic 3D body styles, not exact replicas of any make or model. On-screen shades are approximate. Vehicle data: NHTSA vPIC.'));

  /* ---------- 3D (lazy) ---------- */
  let T = null, renderer, scene, camera, controls, sun, ground, gltfLoader, dirty = true, visible = true;
  const modelCache = new Map();       // body -> Promise<{ scene, panes, ws }>
  let current = null, loadToken = 0, threeReady = null;
  const panesNow = () => (current ? current.panes : {});
  const readyResolvers = [];
  const api = {};

  function applyVLT(m, v) {                       // same curve as viewer.html / build_sedan.py set_vlt
    const t = v / 100, f = Math.min(1, t / 0.7);
    m.opacity = Math.min(0.97, 1 - t);
    const c = 0.004 + 0.016 * f;
    m.color.setRGB(c, c * 1.15, c * 1.35, T.LinearSRGBColorSpace);
    m.specularIntensity = 0.25 + 0.75 * f;
    m.envMapIntensity = 0.35 + 0.65 * f;
    m.needsUpdate = true;
  }
  function paintGlass() {
    if (!current || !T) return;
    const p = current.panes;
    for (const g of GROUP_KEYS) {
      for (const n of GROUPS[g]) {
        if (!p[n] || n === 'glass_windshield') continue;
        applyVLT(p[n].material, state.vlt[g]);
      }
    }
    const ws = current.ws;
    if (ws) {
      const mode = state.windshieldMode;
      applyVLT(ws.main.material, mode === 'full' ? state.vlt.windshield : CLEAR_VLT);
      ws.main.material.clippingPlanes = mode === 'strip' ? [ws.belowPlane] : null;
      ws.strip.visible = mode === 'strip';
      applyVLT(ws.strip.material, state.vlt.windshield);
    }
    dirty = true;
  }

  async function initThree() {
    if (threeReady) return threeReady;
    threeReady = (async () => {
      const [THREE, { OrbitControls }, { GLTFLoader }, { RoomEnvironment }, { MeshoptDecoder }] = await Promise.all([
        import(CDN + '/+esm'),
        import(CDN + '/examples/jsm/controls/OrbitControls.js/+esm'),
        import(CDN + '/examples/jsm/loaders/GLTFLoader.js/+esm'),
        import(CDN + '/examples/jsm/environments/RoomEnvironment.js/+esm'),
        import(CDN + '/examples/jsm/libs/meshopt_decoder.module.js/+esm'),
      ]);
      T = THREE;
      try {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch (e) { throw new Error('webgl'); }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = T.NeutralToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.localClippingEnabled = true;
      renderer.domElement.className = 'ctv-canvas';
      stage.prepend(renderer.domElement);

      scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.85;
      pmrem.dispose();

      camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(-4.6, 1.9, 5.6);
      sun = new T.DirectionalLight(0xffffff, 2.0);
      sun.position.set(3.5, 8, 4.5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.bias = -0.0004;
      sun.shadow.radius = 4;
      const fill = new T.DirectionalLight(0xdfeaf5, 0.6);
      fill.position.set(-5, 3, -4);
      scene.add(sun, sun.target, fill, new T.HemisphereLight(0xeef5ff, 0x9a948a, 0.55));
      ground = new T.Mesh(new T.CircleGeometry(14, 64), new T.ShadowMaterial({ opacity: 0.22 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
      scene.add(ground);
      // soft contact shadow under the car
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 6, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      const blob = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2; blob.position.y = 0.002; blob.name = 'ctv_contact_shadow';
      scene.add(blob); api._blob = blob;

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minPolarAngle = 0.2; controls.maxPolarAngle = Math.PI / 2 - 0.06;
      controls.rotateSpeed = 0.8; controls.zoomSpeed = 0.8;
      controls.autoRotate = autoRotate; controls.autoRotateSpeed = 0.9;
      controls.addEventListener('start', () => { controls.autoRotate = false; root.classList.add('ctv-touched'); });
      controls.addEventListener('change', () => { dirty = true; });

      gltfLoader = new GLTFLoader();
      gltfLoader.setMeshoptDecoder(MeshoptDecoder);

      const ro = new ResizeObserver(resize); ro.observe(stage); resize();
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { rootMargin: '100px' }).observe(stage);
      renderer.setAnimationLoop(() => {
        if (!visible) return;
        const moved = controls.update();
        if (moved || dirty) { renderer.render(scene, camera); dirty = false; api.frames = (api.frames || 0) + 1; }
      });
    })();
    return threeReady;
  }

  function resize() {
    if (!renderer) return;
    const w = stage.clientWidth, hh = stage.clientHeight;
    if (!w || !hh) return;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.fov = w / hh < 1 ? 40 : 32;
    camera.updateProjectionMatrix();
    if (current) fitLimits(current, false);
    dirty = true;
  }

  function fitDistance(entry) {
    const vf = T.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    return (entry.radius / Math.sin(Math.min(vf, hf) / 2)) * (camera.aspect < 1.4 ? 0.92 : 0.74);
  }
  function fitLimits(entry, moveCamera) {
    const d = fitDistance(entry);
    controls.target.copy(entry.target);
    controls.minDistance = d * 0.6; controls.maxDistance = d * 1.6;
    if (moveCamera) {
      const dir = moveCamera === 'reset' ? new T.Vector3(-4.6, 1.9 - 0.6, 5.6).normalize()
        : camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(entry.target).addScaledVector(dir, d);
    } else {
      const cur = camera.position.distanceTo(controls.target);
      if (cur < controls.minDistance || cur > controls.maxDistance) {
        camera.position.copy(controls.target).addScaledVector(camera.position.clone().sub(controls.target).normalize(), d);
      }
    }
    controls.update();
  }

  function prepareModel(gltf, body) {
    const car = gltf.scene;
    car.name = 'ctv_' + body;
    const panes = {};
    car.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false;
      if (ALL_PANES.indexOf(o.name) >= 0) {
        const src = o.material;
        o.material = new T.MeshPhysicalMaterial({ name: src.name, color: 0x050608, roughness: 0.05, metalness: 0,
          transparent: true, depthWrite: false, side: T.DoubleSide, specularIntensity: 1 });
        if (src.dispose) src.dispose();
        o.renderOrder = 2; o.castShadow = false;
        panes[o.name] = o;
      } else if (o.material && o.material.transparent) {
        o.material.depthWrite = false; o.renderOrder = 1;
      }
    });
    const box = new T.Box3().setFromObject(car);
    const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    const entry = { scene: car, panes, body, size, box,
      target: new T.Vector3(center.x, box.min.y + size.y * 0.42, center.z),
      radius: Math.max(size.x, size.z) * 0.5 * 1.08 + 0.15, ws: null };
    const w = panes.glass_windshield;
    if (w) {
      w.updateWorldMatrix(true, false);
      const wb = new T.Box3().setFromObject(w);
      const yCut = wb.max.y - (wb.max.y - wb.min.y) * STRIP_FRACTION;
      const strip = new T.Mesh(w.geometry, w.material.clone());
      strip.name = 'glass_windshield_strip';
      strip.renderOrder = 3; strip.castShadow = false;
      strip.material.clippingPlanes = [new T.Plane(new T.Vector3(0, 1, 0), -yCut)];   // keep y > yCut
      w.add(strip);   // same transform as the windshield (geometry is local to it)
      entry.ws = { main: w, strip, belowPlane: new T.Plane(new T.Vector3(0, -1, 0), yCut), yCut };
    }
    return entry;
  }

  function loadBody(body) {
    if (modelCache.has(body)) return modelCache.get(body);
    const p = new Promise((resolve, reject) => {
      gltfLoader.load(assetBase + body + '.glb', (gltf) => resolve(prepareModel(gltf, body)), (ev) => {
        if (ev && ev.lengthComputable && body === state.body) loaderText.textContent = 'Loading ' + BODY_LABEL[body] + '… ' + Math.round((100 * ev.loaded) / ev.total) + '%';
      }, (err) => reject(err));
    });
    modelCache.set(body, p);
    p.catch(() => modelCache.delete(body));
    return p;
  }

  async function showBody(body) {
    const token = ++loadToken;
    root.setAttribute('data-state', 'loading');
    loader.hidden = false; loader.classList.remove('ctv-err');
    loaderText.textContent = T ? 'Loading ' + BODY_LABEL[body] + '…' : 'Loading 3D viewer…';
    try {
      await initThree();
      loaderText.textContent = 'Loading ' + BODY_LABEL[body] + '…';
      const entry = await loadBody(body);
      if (token !== loadToken) return;
      if (current) scene.remove(current.scene);
      current = entry;
      scene.add(entry.scene);
      const s = entry.size, m = Math.max(s.x, s.z) * 0.62;
      Object.assign(sun.shadow.camera, { left: -m, right: m, top: m, bottom: -m, near: 0.5, far: 25 });
      sun.shadow.camera.updateProjectionMatrix();
      api._blob.scale.set(s.x * 1.35, s.z * 1.2, 1);
      api._blob.position.set(entry.target.x, 0.002, entry.target.z);
      fitLimits(entry, api._fitted ? true : 'reset'); api._fitted = true;
      updateGroupAvailability();
      paintGlass();
      loader.hidden = true;
      root.setAttribute('data-state', 'ready');
      root.setAttribute('data-body', body);
      readyResolvers.splice(0).forEach((r) => r(body));
      root.dispatchEvent(new CustomEvent('ctv:ready', { detail: { body } }));
    } catch (err) {
      if (token !== loadToken) return;
      console.warn('[Coastal Tint visualizer]', err);
      loader.hidden = false; loader.classList.add('ctv-err');
      root.setAttribute('data-state', 'error');
      loaderText.textContent = '';
      loaderText.append(err && err.message === 'webgl' ? '3D preview needs WebGL, which this browser has turned off.' : 'Couldn’t load the 3D preview. ',
        err && err.message === 'webgl' ? '' : h('button', { type: 'button', class: 'ctv-btn', onclick: () => { threeReady = threeReady && T ? threeReady : null; showBody(state.body); } }, 'Retry'));
    }
  }

  /* ---------- tint state ---------- */
  function groupsPresent() {
    const p = panesNow();
    return GROUP_KEYS.filter((g) => GROUPS[g].some((n) => p[n]));
  }
  function updateGroupAvailability() {
    const present = current ? groupsPresent() : GROUP_KEYS;
    for (const g of GROUP_KEYS) groupBtns[g].hidden = present.indexOf(g) < 0;
    if (state.group !== 'all' && present.indexOf(state.group) < 0) selectGroup('all');
  }
  function groupValue(g) {
    if (g !== 'all') return state.vlt[g];
    const vs = (current ? groupsPresent() : GROUP_KEYS).map((k) => state.vlt[k]);
    return vs.every((v) => v === vs[0]) ? vs[0] : null;
  }
  function syncTintUI() {
    const v = groupValue(state.group);
    groupName.textContent = GROUP_LABEL[state.group];
    slider.value = String(v == null ? state.vlt.front : v);
    vltOut.textContent = v == null ? 'Mixed' : v + '%';
    slider.setAttribute('aria-valuetext', v == null ? 'Mixed' : v + ' percent VLT');
    for (const b of presetBtns) b.setAttribute('aria-pressed', String(+b.getAttribute('data-vlt') === v));
    for (const g in groupBtns) {
      groupBtns[g].setAttribute('aria-selected', String(g === state.group));
      const gv = groupValue(g);
      let txt = gv == null ? 'mixed' : gv + '%';
      if (g === 'windshield' && state.windshieldMode === 'strip') txt = gv + '% strip';
      if (g === 'windshield' && state.windshieldMode === 'none') txt = 'clear';
      groupBtns[g].querySelector('.ctv-tab-v').textContent = txt;
    }
    for (const k in wsModeBtns) wsModeBtns[k].setAttribute('aria-pressed', String(k === state.windshieldMode));
    wsRow.hidden = !(state.group === 'windshield' || state.group === 'all');
    root.setAttribute('data-vlt', JSON.stringify(state.vlt) + '|' + state.windshieldMode);
  }
  function setTint(g, v) {
    v = clampVLT(v);
    if (g === 'all') for (const k of GROUP_KEYS) state.vlt[k] = v; else state.vlt[g] = v;
    if (g === 'windshield' && state.windshieldMode === 'none') state.windshieldMode = 'strip';
    paintGlass(); syncTintUI();
  }
  function selectGroup(g) { state.group = g; syncTintUI(); }
  function setWindshieldMode(m) { state.windshieldMode = m; paintGlass(); syncTintUI(); }
  slider.addEventListener('input', () => setTint(state.group, slider.value));

  /* ---------- body ---------- */
  function setBody(body) {
    if (!BODY_LABEL[body]) body = 'sedan';
    state.body = body;
    for (const k in bodyBtns) bodyBtns[k].setAttribute('aria-pressed', String(k === body));
    updateVehLabel();
    return showBody(body);
  }
  function updateVehLabel() {
    const name = [state.year, state.make, state.model].filter(Boolean).join(' ');
    vehLabel.textContent = name || BODY_LABEL[state.body];
    vehNote.textContent = name ? 'Shown as: ' + BODY_LABEL[state.body] : 'Pick your vehicle, or choose a body type';
  }
  function updateBodyNote(text) {
    if (text != null) { bodyNote.textContent = text; return; }
    bodyNote.textContent = state.bodySource === 'manual' ? 'You picked ' + BODY_LABEL[state.body] + '.' : bodyNote.textContent;
  }

  /* ---------- vehicle pickers ---------- */
  let makesLoaded = false, modelList = [];
  const setStatus = (t, err) => { status.textContent = t || ''; status.classList.toggle('ctv-err', !!err); };
  function fillMakes(all) {
    makeSel.textContent = '';
    makeSel.append(h('option', { value: '' }, 'Make'));
    const pop = h('optgroup', { label: 'Popular' }, POPULAR_MAKES.map((m) => h('option', { value: m }, m)));
    makeSel.append(pop);
    if (all && all.length) {
      const popU = new Set(POPULAR_MAKES.map((m) => m.toUpperCase()));
      makeSel.append(h('optgroup', { label: 'All makes' }, all.filter((m) => !popU.has(m.toUpperCase())).map((m) => h('option', { value: m }, m))));
    }
  }
  fillMakes(null);
  async function loadMakes() {
    if (makesLoaded) return; makesLoaded = true;
    try { const all = await getMakes(); const keep = makeSel.value; fillMakes(all); makeSel.value = keep; }
    catch (e) { /* popular list still works */ }
  }
  yearSel.addEventListener('change', () => {
    state.year = yearSel.value;
    makeSel.disabled = !state.year;
    if (state.year) loadMakes();
    if (state.year && makeSel.value) loadModelList(); else resetModels();
    updateVehLabel();
  });
  makeSel.addEventListener('change', () => { state.make = makeSel.value; state.model = ''; if (state.make) loadModelList(); else resetModels(); updateVehLabel(); });
  function resetModels() {
    modelSel.textContent = ''; modelSel.append(h('option', { value: '' }, 'Model')); modelSel.disabled = true; state.model = '';
  }
  async function loadModelList() {
    const year = state.year, make = state.make;
    resetModels();
    modelSel.firstChild.textContent = 'Loading models…';
    setStatus('');
    try {
      const list = await getModels(make, year);
      if (year !== state.year || make !== state.make) return;
      modelList = list;
      modelSel.firstChild.textContent = list.length ? 'Model' : 'No models found';
      list.forEach((m, i) => modelSel.append(h('option', { value: String(i) }, m.name)));
      modelSel.disabled = !list.length;
      if (!list.length) setStatus('No ' + year + ' ' + make + ' models found. Pick your body type below.');
      root.setAttribute('data-models', String(list.length));
    } catch (e) {
      if (year !== state.year || make !== state.make) return;
      modelSel.firstChild.textContent = 'Model list unavailable';
      setStatus('Vehicle lookup isn’t available right now. Pick your body type below.', true);
      root.setAttribute('data-models', 'error');
    }
  }
  modelSel.addEventListener('change', () => {
    const m = modelList[+modelSel.value];
    if (!m || modelSel.value === '') { state.model = ''; updateVehLabel(); return; }
    state.model = m.name;
    const obj = Object.assign(new String(m.name), { vtypes: m.vtypes });
    const inf = inferBodyClass(obj, m.vtype);
    const body = bodyFromBodyClass(inf.bodyClass);
    state.bodyClass = inf.bodyClass; state.bodySource = 'vpic';
    const multi = RX_MULTI.test(m.name.toLowerCase()) && m.vtype === 'car';
    updateBodyNote('Matched ' + BODY_LABEL[body] + ' (' + inf.why + ').' + (multi ? ' This model comes in more than one body style. Pick yours if it differs.' : ' Not right? Pick your body type.'));
    root.setAttribute('data-bodyclass', inf.bodyClass);
    setBody(body);
  });
  async function vinLookup() {
    const vin = vinInput.value.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9*]{11,17}$/.test(vin)) { vinMsg.textContent = 'Enter the 17-character VIN (no I, O or Q).'; return; }
    vinMsg.textContent = 'Looking up…';
    try {
      const r = await decodeVin(vin);
      if (!r || !r.BodyClass) { vinMsg.textContent = 'Couldn’t read the body style from that VIN. Pick your body type above.'; return; }
      const body = bodyFromBodyClass(r.BodyClass);
      state.year = r.ModelYear || state.year; state.make = r.Make ? pretty(r.Make) : state.make; state.model = r.Model || state.model;
      state.bodyClass = r.BodyClass; state.bodySource = 'vin';
      vinMsg.textContent = [r.ModelYear, r.Make && pretty(r.Make), r.Model].filter(Boolean).join(' ') + ': ' + r.BodyClass + ' → ' + BODY_LABEL[body];
      updateBodyNote('Matched ' + BODY_LABEL[body] + ' from your VIN.');
      root.setAttribute('data-bodyclass', r.BodyClass);
      setBody(body);
    } catch (e) { vinMsg.textContent = 'VIN lookup isn’t available right now. Pick your body type above.'; }
  }
  vinBtn.addEventListener('click', vinLookup);
  vinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); vinLookup(); } });

  resetBtn.addEventListener('click', () => { if (current && controls) { fitLimits(current, 'reset'); dirty = true; } });

  /* ---------- public API (handy for testing / site scripts) ---------- */
  Object.assign(api, {
    state, setBody, setTint, selectGroup, setWindshieldMode,
    bodyFromBodyClass, inferBodyClass,
    ready: () => (root.getAttribute('data-state') === 'ready' ? Promise.resolve(state.body) : new Promise((r) => readyResolvers.push(r))),
    panes: () => Object.keys(panesNow()),
    paneInfo: () => Object.fromEntries(Object.entries(panesNow()).map(([n, o]) => [n, { opacity: +o.material.opacity.toFixed(3), visible: o.visible }])),
    windshieldInfo: () => (current && current.ws ? { mode: state.windshieldMode, mainOpacity: +current.ws.main.material.opacity.toFixed(3),
      stripOpacity: +current.ws.strip.material.opacity.toFixed(3), stripVisible: current.ws.strip.visible, yCut: current.ws.yCut } : null),
    cachedBodies: () => [...modelCache.keys()],
    setAutoRotate: (on) => { if (controls) controls.autoRotate = !!on; },
    cameraAzimuth: () => (controls ? +controls.getAzimuthalAngle().toFixed(4) : null),
    cameraDistance: () => (controls ? +controls.getDistance().toFixed(3) : null),
  });
  root.__ctv = api;

  // initial state: body pills + tint UI now, 3D when the viewer nears the viewport
  for (const k in bodyBtns) bodyBtns[k].setAttribute('aria-pressed', String(k === state.body));
  updateVehLabel(); syncTintUI();
  bodyNote.textContent = 'Pick your vehicle above, or choose a body type.';
  const start = () => showBody(state.body);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '400px' });
    io.observe(root);
  } else start();
  return api;
}

function boot() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  window.CoastalTintVisualizer = mount(root);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
export { mount, bodyFromBodyClass, inferBodyClass };
