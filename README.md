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
| `index.html` | Local test page (includes a deliberately hostile theme `button` style to check CSS isolation and a simulated 90px fixed site header). |
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
<div id="ct-tint-visualizer" data-asset-base="https://cdn.jsdelivr.net/gh/CoastalTint/tint-visualizer@main/" data-quote-url="https://brightledger-deal-desk.lovable.app/quote"></div>
<script type="module" src="https://cdn.jsdelivr.net/gh/CoastalTint/tint-visualizer@main/tint-visualizer.js"></script>
```

The snippet has **no inline JavaScript** and no `&`, `--` or quote characters that wptexturize rewrites. The previous build broke when `&&` became `&#038;&#038;`.
All logic lives in the external `.js` file, which WordPress never touches. Use a single visualizer per page; the id is fixed.

### Data attributes

| Attribute | Default | Meaning |
|---|---|---|
| `data-asset-base` | `models/` next to the JS file | Folder URL of the GLBs; the filename (e.g. `suv.glb`) is appended. A trailing slash is added if missing. |
| `data-quote-url` | `/contact/` | Target of the "Get a quote" button. The snippet points it at the CRM quote form (`https://brightledger-deal-desk.lovable.app/quote`). The customer's selection is appended as query parameters (see below). A URL on a different origin opens in a new tab (`target="_blank" rel="noopener"`); a same-origin URL such as `/contact/` opens in the same tab. |
| `data-sticky-top` | measured | Height in px of the site's fixed/sticky header. If omitted, the widget measures it (fixed or sticky elements at the top of the page) and sets `--ctv-sticky-top`; the CSS fallback is 90px on desktop and 70px at 860px and below. |
| `data-autorotate` | `true` | `false` disables the slow idle spin. |

### Quote link parameters

The "Get a quote" `href` is rebuilt on every vehicle, VIN, body type, window-group or shade change. Values are URL-encoded (`2019 Ford F-150` → `2019+Ford+F-150`, `20%` → `20%25`). Parameters are in this order:

| Parameter | When sent | Value |
|---|---|---|
| `vehicle` | a year, make or model is picked | `"<year> <make> <model>"` from the parts picked, e.g. `2019 Ford F-150` (only `2019` if only a year is picked) |
| `year`, `make`, `model` | each one that is picked | e.g. `2019`, `Ford`, `F-150` |
| `vin` | a VIN (11–17 chars; partial VINs with `*` are allowed) is typed | e.g. `1FTEW1E54KFA12345` |
| `body` | always | `sedan`, `coupe`, `hatchback`, `suv`, `truck` or `van` |
| `front`, `rear`, `back`, `sunroof` | each window group the model has (all six models have all four), including untouched defaults | a CRM shade with `%`: `5%`, `15%`, `20%`, `35%`, `50%` or `75%`. `rear` covers the rear doors and quarters. |
| `windshield` | only when the windshield mode is **Full** | the chosen shade with `%`. The CRM bills a numeric windshield value as the full-windshield add-on. |
| `vlt_sunstrip` | only when the windshield mode is **Top strip** | the strip shade as a bare number, e.g. `15` (the CRM's sun-strip add-on) |
| *(none)* | windshield mode **Clear** (the default) | neither `windshield` nor `vlt_sunstrip` is sent, so no windshield charge |
| `vlt` | front, rear, back and sunroof (plus the windshield in Full mode) all have the same shade | that shade without `%`, e.g. `20` |
| `service` | always | `tint` |
| `source` | always | `tint-visualizer` |
| `utm_source`, `utm_medium`, `utm_campaign` | always | `website`, `visualizer`, `tint-visualizer` |

**Shade snapping.** The CRM accepts only 5, 15, 20, 35, 50 and 75. The slider stays free-range (5–90%), so each window's current VLT is snapped to the nearest allowed shade when the link is built (ties go to the lighter shade); anything at or above 62% is sent as 75. Examples: 9→5, 10→15, 17→15, 18→20, 27→20, 28→35, 42→35, 43→50, 61→50, 62→75, 90→75. No `film` parameter is sent; the CRM defaults to Geoshield ProNano Ceramic.

Example (2019 Ford F-150, Clear windshield, side and back windows 20%, then rear 5%):

```
https://brightledger-deal-desk.lovable.app/quote?vehicle=2019+Ford+F-150&year=2019&make=Ford&model=F-150&body=truck&front=20%25&rear=5%25&back=20%25&sunroof=20%25&service=tint&source=tint-visualizer&utm_source=website&utm_medium=visualizer&utm_campaign=tint-visualizer
```

With all windows at 20% the same link also has `vlt=20` (after `sunroof`).

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
  - Clear (default): no windshield tint and no windshield param in the quote link.
  - Top strip: a sun strip covering the top 25% of the windshield, measured along the glass down its centre line (about 8–9 inches on a real windshield), gets the chosen VLT and the rest stays clear. The same fraction is used on all six models. The strip's lower edge is a cut by a plane square to the glass (not an offset from the curved top edge), so it reads as a nearly straight line with only the gentle curve of the glass. It is done with a clipped clone of the pane.
  - Full: the whole windshield gets the chosen VLT.
- **Tint curve**: opacity = 1 − VLT/100 (max 0.97) on a dark tinted physical glass material, with reflections. Presets are 5/15/20/35/50/75%, matching the CRM's shades; the slider goes 5–90%.
- **vPIC**: makes come from a built-in popular list plus all makes from `GetMakesForVehicleType`. Models come from `GetModelsForMakeYear` for vehicle types car, MPV and truck. Those endpoints return a vehicle *type*, not a BodyClass, so a model-name heuristic turns them into a vPIC-style BodyClass:
  - truck → Pickup
  - Transit/Sprinter/Odyssey/Sienna… → Van/Minivan
  - MPV → SUV
  - Mustang/Camaro/MX-5… → Coupe/Convertible
  - Golf/Fit/… → Hatchback, …

  The BodyClass is then mapped to a GLB: sedan; coupe (incl. convertible); hatchback (incl. wagon); SUV/crossover/MPV → suv; pickup → truck; van/minivan → van; anything else → sedan. The optional **VIN** box calls `DecodeVinValues` and uses the real BodyClass; partial VINs with `*` work. The body-type pills are always shown, so the customer can override. If vPIC is unreachable, the status line says so and the pills still work.
- **Mobile**: drag/pinch on the stage with OrbitControls (damping, limited zoom range). The stage uses `touch-action: none`, so a finger on the 3D view rotates the car instead of scrolling the page. The page still scrolls everywhere else. At 860px and below the layout stacks: the car viewer sticks under the site header (`top: var(--ctv-sticky-top)`, about 40vh tall) while the controls scroll beneath it, with a compact vehicle picker, a horizontally scrollable window-group row and all six presets on one row. Note: `position: sticky` does not work if a theme sets `overflow: hidden` (or `auto`) on an ancestor of the widget.
- **Sticky header**: the root has `scroll-margin-top` (header height + 20px), and in-widget scrolling respects it. On desktop the viewer is `clamp(360px, 100vh − header − 230px, 540px)` tall with `max-height: calc(100vh − 140px)`, so the viewer and its controls fit below a ~110px header at 1280×800.

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
- `quoteHref()` / `quoteParams()` (the current quote link and its parameters)
- `setView(azimuth, polar, distance)` (radians; azimuth 0 = from the front)

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
node /workspace/tv-build/test.mjs      # main Playwright suite -> tv-build/test-results.json
node /workspace/tv-build/quote.mjs     # quote link (F-150, SUV + sunroof, snapping, /contact/) -> quote-results.json
node /workspace/tv-build/v2layout.mjs  # desktop/mobile sticky layout + v2-*.png screenshots
node /workspace/tv-build/strip.mjs     # windshield strip screenshots strip-<model>-top/front34.png
```

## Notes

- The page shows a short neutral note: California limits tint on the windshield and front side windows; check current CA law or ask us. It makes no other legal claims, and there are no prices or performance figures.
- The preview is illustrative; real film looks different depending on light and glass.
