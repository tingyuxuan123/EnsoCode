# Collabra logo

`collabra-logo.png` is the original 1024 × 1024 transparent PNG supplied by the
project owner for the Collabra rebrand. Its SHA-256 is
`6b9f1f45e0fc822dcff502815147377a421c36074ca5c31be15873fe31f6b87c`.

Run `node scripts/generate-app-icon.mjs` from the workspace to regenerate the
desktop PNG/SVG/ICO/ICNS family, tray templates, phone UI/PWA icons, and Android
drawable PNGs. The full-colour artwork retains the supplied shape and gradient;
desktop Dock / installer assets add a white rounded backing with a subtle edge.
`build/brand-mark.png` is the separate transparent in-app logo, so the desktop
backing never leaks into chat footers or design watermarks. System templates
use the logo's monochrome alpha silhouette. PWA installation icons
have a white background, while in-app marks remain transparent. Adaptive Android
icons are inset to keep the artwork inside the launcher's safe circle.

The old `enso` / `eaves` resource identifiers remain for compatibility. Earlier
`xiaoman-*` images in this directory are historical concepts, not shipped artwork.
