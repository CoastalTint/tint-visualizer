# Coastal Tint – Window Tint Visualizer

A self-contained 3D window tint preview for the Coastal Tint WordPress.com site.
The customer picks a year, make and model (NHTSA vPIC), or picks a body type directly. They can then rotate a white car 360°
and preview tint shades (VLT) on all windows or per window group.

## Files

| File | Purpose |
|---|---|
| `tint-visualizer.js` | ES module. Mounts into `#ct-tint-visualizer`. Loads three.js 0.170.0 from jsDelivr (pinned). |
| `tint-visualizer.css` | All rules scoped under `#ct-tint-visualizer`. If the `<link>` is omitted, the JS injects it automatically (same folder as the JS). |
| `models/*.glb` | sedan, coupe, hatchback, suv, truck, van. Meshopt-compressed and quantized; mesh and material names are preserved. |
| `embed-snippet.html` | What goes in the WordPress Custom HTML block. |
| `index.html` | Local test page (includes a deliberately hostile theme `button` style to check CSS isolation). |
| `screenshots/` | Headless test captures. |

## Hosting

1. Upload this whole folder (models sit next to the JS in this repo) to a static host that serves HTTPS. For example:
   - WordPress.com SFTP (Business plan and up), e.g. `/wp-content/uploads/tint-visualizer/`.
   - Any CDN or bucket: Cloudflare R2/Pages, Netlify, S3+CloudFront, GitHub Pages.
2. Make sure the host:
   - serves `.js` as `text/javascript` (required for `type="module"`);
   - serves `.glb` as `model/gltf-binary` (`application/octet-stream` also works);
   - if the files are on a different origin than the WordPress site, sends `Access-Control-Allow-Origin: *` (or the site origin) for the `.js`, `.css` and `.glb` files. Module scripts and `fetch()` of GLBs are CORS requests.
3. Optional: cache with a long TTL (`Cache-Control: public, max-age=31536000, immutable`) and rename or version the folder when you update. GLBs are already compressed, so gzip on the host saves only about 50% more. Brotli/gzip for the JS and CSS is recommended.
4. In `embed-snippet.html`, replace `https://cdn.jsdelivr.net/gh/CoastalTint/tint-visualizer@main/` with the real URL (3 places).

## Embedding in WordPress.com

Add a **Custom HTML** block to the page and paste the 3 lines of `embed-snippet.html`:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/CoastalTint/tint-visualizer@main/tint-visualizer.css">
<div id="ct-tint-visualizer" data-asset-base="https://cdn.jsdelivr.net/gh/CoastalTint/tint-visualizer@main/" data-quote-url="/contact/"></div>
<script type="module" src="https://cdn.jsdelivr.net/gh/CoastalTint/tint-visualizer@main/tint-visualizer.js"></script>
```

The snippet has **no inline JavaScript** and no `&`, `--` or quote characters that wptexturize rewrites. The previous build broke when `&&` became `&#038;&#038;`.
All logic lives in the external `.js` file, which WordPress never touches. Use a single visualizer per page; the id is fixed.

### Data attributes

| Attribute | Default | Meaning |
|---|---|---|
| `data-asset-base` | `models/` next to the JS file | Folder URL of the GLBs; the filename (e.g. `suv.glb`) is appended. A trailing slash is added if missing. |
| `data-quote-url` | `/contact/` | Target of the "Get a quote" button. |
| `data-autorotate` | `true` | `false` disables the slow idle spin. |

## How it works

- **three.js** `0.170.0`, core + `OrbitControls`, `GLTFLoader`, `RoomEnvironment`, `meshopt_decoder`. All are loaded through jsDelivr `+esm` URLs, which resolve to one shared three instance. No import map is used, so there's no conflict with WordPress's own import map. three.js is only downloaded when the widget scrolls near the viewport.
- **Models** are lazy-loaded: only the selected body's GLB is fetched (about 650–770 KB each) and then cached in memory, so switching back is instant. A loading spinner shows percent progress.
- **Glass**: the code matches only these exact pane names:
  - `glass_windshield`
  - `glass_front_left` / `glass_front_right`
  - `glass_rear_left` / `glass_rear_right`
  - `glass_quarter_left` / `glass_quarter_right`
  - `glass_back`
  - `glass_sunroof`

  `glass_back_gasket` (truck and van) is trim, not glass, and is left alone. Groups are:
  - Windshield
  - Front sides
  - Rear sides (rear doors + quarters)
  - Back glass
  - Sunroof

  Tabs for groups a model lacks are hidden.
- **Windshield** modes:
  - Top strip (default): the top ~13% of the windshield gets the chosen VLT and the rest stays clear, done with a clipped clone of the pane.
  - Full.
  - Clear.
- **Tint curve**: opacity = 1 − VLT/100 (max 0.97) on a dark tinted physical glass material, with reflections. Presets are 5/15/20/35/50/70%; the slider goes 5–90%.
- **vPIC**: makes come from a built-in popular list plus all makes from `GetMakesForVehicleType`. Models come from `GetModelsForMakeYear` for vehicle types car, MPV and truck. Those endpoints return a vehicle *type*, not a BodyClass, so a model-name heuristic turns them into a vPIC-style BodyClass:
  - truck → Pickup
  - Transit/Sprinter/Odyssey/Sienna… → Van/Minivan
  - MPV → SUV
  - Mustang/Camaro/MX-5… → Coupe/Convertible
  - Golf/Fit/… → Hatchback, …

  The BodyClass is then mapped to a GLB: sedan; coupe (incl. convertible); hatchback (incl. wagon); SUV/crossover/MPV → suv; pickup → truck; van/minivan → van; anything else → sedan. The optional **VIN** box calls `DecodeVinValues` and uses the real BodyClass; partial VINs with `*` work. The body-type pills are always shown, so the customer can override. If vPIC is unreachable, the status line says so and the pills still work.
- **Mobile**: drag/pinch on the stage with OrbitControls (damping, limited zoom range). The stage uses `touch-action: none`, so a finger on the 3D view rotates the car instead of scrolling the page. The page still scrolls everywhere else. The layout stacks below 860px.

## JS API (for testing)

`window.CoastalTintVisualizer` offers:
- `setBody('suv')`
- `setTint('all'|'windshield'|'front'|'rear'|'back'|'sunroof', vlt)`
- `setWindshieldMode('strip'|'full'|'none')`
- `selectGroup(g)`
- `panes()`
- `paneInfo()`
- `windshieldInfo()`
- `cachedBodies()`
- `setAutoRotate(bool)`
- `cameraAzimuth()`
- `bodyFromBodyClass(str)`
- `inferBodyClass(...)`
- `ready()`

The root element exposes `data-state` (`loading|ready|error`), `data-body` and `data-bodyclass`, and dispatches a `ctv:ready` event.

## Rebuilding the models

Originals are in `/workspace/visualizer-models/` (untouched). Optimization: `node /workspace/tv-build/optimize.mjs`, which uses gltf-transform v4 with these steps:
- dedup (accessors only, so material names survive)
- weld
- prune
- reorder
- quantize (position 14-bit, normal 10-bit)
- `EXT_meshopt_compression` (filter mode)

The script verifies that every mesh and material name is still present.

## Local test

```bash
cd tint-visualizer-dist && python3 -m http.server 8765
# open http://127.0.0.1:8765/index.html
node /workspace/tv-build/test.mjs   # Playwright suite, writes screenshots/ and tv-build/test-results.json
```

## Notes

- The page shows a short neutral note: California limits tint on the windshield and front side windows; check current CA law or ask us. It makes no other legal claims, and there are no prices or performance figures.
- The preview is illustrative; real film looks different depending on light and glass.
