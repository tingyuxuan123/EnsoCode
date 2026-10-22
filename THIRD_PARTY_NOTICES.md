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
