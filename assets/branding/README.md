# CodeKiln logo

`codekiln-logo.png` is the supplied 2048 × 2048 artwork for the CodeKiln rename:
a dark rounded plate holding a pixel-art stone arch and fire. Its SHA-256 is
`f0542aa671f9adb20d7512cdffcb129c9416662dc51b22ddddc77abe710afa9d`.

Run `node scripts/generate-app-icon.mjs` from the workspace to regenerate the
desktop PNG/SVG/ICO/ICNS family, tray templates, phone UI/PWA icons and Android
drawable PNGs. The script is the only authoritative generator; the older
`generate-app-icon.py` was removed rather than left to regenerate the previous
artwork.

How the supplied artwork becomes each asset:

- The source is a plate on a white surround with a faint generation glow, so the
  plate is cropped 18px inside its measured bounds and masked to its own rounded
  corners (radius 282 of 1724). Corners stay transparent and no white card is
  added behind it: the plate itself is the icon shape.
- `build/brand-mark.png` (in-app header, chat footer, design watermark) and the
  Android `codekiln_mark` / `codekiln_running_small` drawables use the same plate.
- Menu bar, notification and Android themed/monochrome layers need a single flat
  colour, so they use the fire's silhouette: the largest warm-colour connected
  component, row-filled to close the dark cavities inside the flame, with sparks
  dropped. System themes tint it themselves.
- PWA home-screen icons must be opaque. They are flattened onto the plate's own
  dark blue (`#101B29`); maskable icons are inset so launcher masks never crop the
  arch.
- Adaptive Android launcher layers keep the plate as the foreground (it covers
  the visible circle) and the flame silhouette as the monochrome layer.

Older `collabra-logo*`, `xiaoman-*` and `eaves-logo.vetd` files are historical
concepts from earlier brands, not shipped artwork. The plugin market identity
(`collabra` market id, `collabra.paper` plugin id) is a signed snapshot and keeps
its name until that market is re-signed.
