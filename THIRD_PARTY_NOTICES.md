# Third-party notices

## Devin code search

The bounded code-search loop, local workspace reader, and private Devin/Windsurf
search protocol in `src/agent/codeSearch/` are adapted from
[dsh-devin-search](https://github.com/mimimaster/dsh-devin-search), version 0.2.10,
and its documented MIT-licensed Piwin protocol sources. They do not import the
DSH runtime, Pi CLI extension, or either project's credential files.

Original protocol references identified by the upstream NOTICE:

- `packages/agent-host/src/devin/oauth.ts`
- `packages/tools-web/src/devin-search-provider.ts`
- `packages/host-runtime/src/code-search/backends/windsurf-protobuf.ts`
- `packages/host-runtime/src/code-search/backends/windsurf-protocol.ts`
- `packages/host-runtime/src/code-search/completion-port.ts`

EnsoCode, dsh-devin-search and Piwin are independent of Devin/Windsurf. Offline
fixtures do not establish live compatibility, account entitlements, pricing,
service availability, or continued authorization. Source-code licensing does
not grant rights to use a provider's service or third-party code assets.

### MIT License

Copyright (c) 2026 dsh-devin-search contributors

Copyright (c) 2026 Piwin contributors (adapted protocol portions)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Open Vetta design subsystem

The design subsystem source, Vite engine, history runner, designer preset and
skill documentation are ported from Open Vetta's `vetta-ui-design` plugin
(`package.json` 0.1.15 / `plugin.json` 0.7.6), licensed under Apache-2.0.
The full Apache License and original upstream NOTICE are distributed in
`resources/design/LICENSE` and `resources/design/NOTICE` (installed as
`design/LICENSE` and `design/NOTICE`, outside the application archive).
Port details and runner rebuild instructions are in `resources/design/UPSTREAM.md`.

The applicable upstream attribution is:

> Open Vetta
> Copyright 2026 Vetta
>
> This product includes software developed at Vetta (https://www.openvetta.com).
>
> Licensed under the Apache License, Version 2.0 (the "License"); you may not use
> this file except in compliance with the License. You may obtain a copy of the
> License in the LICENSE file distributed with this work, or at:
> http://www.apache.org/licenses/LICENSE-2.0

The original NOTICE also attributes taste-skill's design-direction library,
app-screen rules and Unsplash photo index, and Hallmark-derived design
references. Those applicable MIT components are described below. Other upstream
NOTICE entries describe Open Vetta's own runtime, sandbox and model distribution;
this design port does not import those binaries or services. Open Vetta and
EnsoCode are independent; source licensing grants no trademark or image rights.

## taste-skill

The design-direction library, app-screen rules, dealing/rule adaptations and
photo index used by the design subsystem originate from
[taste-skill](https://github.com/Leonxlnx/taste-skill), version 2.1.5, commit
`12af471f627f866411b4bd785b19646d3672784c`. The direction-library and photo-index
JSON are bundled with renderer source, not duplicated in design resources;
adapted rules also appear in the skill documentation. The MIT license covers
the code/data compilation, not the underlying third-party photographs; image
use remains subject to the source's own rights and applicable terms.

### MIT License

Copyright (c) 2026 Leonxlnx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Hallmark

Design references under `resources/design/skills/vetta-ui-design/references/taste/`
are adapted from [Hallmark](https://github.com/Nutlope/hallmark), commit
`13ac0ec7e148655948100b6396439e481361d690`, licensed under MIT.

Copyright (c) 2026 Hallmark contributors

The complete MIT license and adaptation notes are reproduced in that directory's
`UPSTREAM.md`. The MIT text is identical to the taste-skill license above, with
the copyright line of this entry.

## History runner: isomorphic-git / ZenFS LGPL path helper

`design/history-runner/runner.mjs` combines Open Vetta's runner with
isomorphic-git 1.41.3 and fflate 0.8.2. Those packages' MIT license texts are
distributed in `design/history-runner/LICENSES/` (source-tree prefix:
`resources/`). In addition, isomorphic-git's `src/utils/join.js` directly copies
the ZenFS `@zenfs/core/path` helper and explicitly identifies it as
**LGPL-3.0-or-later**, separate from the package-level MIT and Open Vetta Apache
licenses:

> Copyright (c) James Prevett and other ZenFS contributors.
> SPDX-License-Identifier: LGPL-3.0-or-later

This portion is covered by the GNU Lesser General Public License, version 3 or
(at your option) any later version. The complete LGPL-3.0 and referenced GPL-3.0
texts are distributed in `design/history-runner/LICENSES/`. The uncombined
preferred source is `design/history-runner/source/isomorphic-git-join.js`;
the readable, non-minified combined runner and all rebuild inputs are supplied
alongside it. The helper and its use retain their LGPL terms; they are not
relicensed under Apache or MIT. Modification of this portion and reverse
engineering for debugging those modifications are permitted under that license.

Source, exact artifact locations, rebuild/replacement instructions and the
macOS-signature caveat are in `design/UPSTREAM.md`. Full upstream source is at
<https://github.com/isomorphic-git/isomorphic-git>, commit
`aa6812cd674bf2f9d4cd3c9ad7bcaf608ce80b90` (`src/utils/join.js`), with ZenFS
origin at <https://github.com/zen-fs/core/blob/main/src/path.ts>.
