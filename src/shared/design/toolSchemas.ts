import type { DesignToolName } from '../types/design';

/** Open Vetta vetta-ui-design 0.7.6 (Apache-2.0): runtime descriptions/schemas
 * from tools.ts, direction/direction-tool.ts, assets/assets-tool.ts,
 * materials/export-tool.ts, history/history-tools.ts, with referenced constants expanded.
 * Every upstream property/item already declares type; no type supplementation was needed.
 */
export interface DesignArgumentSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, DesignArgumentSchema>;
  items?: DesignArgumentSchema;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean | DesignArgumentSchema;
  description?: string;
  minItems?: number;
  maxItems?: number;
}
export interface DesignToolSchema {
  name: DesignToolName;
  description: string;
  parameters: DesignArgumentSchema;
}

const sectors = [
  'saas',
  'dev-tool',
  'ai-product',
  'consumer-app',
  'finance',
  'agency',
  'studio-portfolio',
  'personal-portfolio',
  'ecommerce',
  'physical-product',
  'fashion',
  'hospitality',
  'restaurant',
  'real-estate',
  'architecture',
  'event',
  'health',
  'education',
  'nonprofit',
  'culture',
  'music',
  'other',
];
const assets = ['photography', 'product-photo', 'product-ui', 'illustration'];
const preferences: DesignArgumentSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      question: { type: 'string', description: "The question you asked, in the user's language." },
      answer: { type: 'string', description: "The user's answer, in their words." },
    },
    required: ['question', 'answer'],
    additionalProperties: false,
  },
  description:
    'Questions you already asked the user and their answers (anything beyond the look question). Recorded in the design and treated as binding; later screens do not ask them again.',
};
const intent: DesignArgumentSchema = {
  type: 'object',
  properties: {
    mood: {
      type: 'string',
      description:
        'The look or feel the user named, or a product/site they referenced, in their words.',
    },
    colour: {
      type: 'string',
      description: 'Colour the user named (dark, warm, a brand hex), in their words.',
    },
    emphasis: {
      type: 'string',
      description: 'What the user said should come first (posters, dense info…).',
    },
    brand: { type: 'string', description: 'An existing brand the user named (e.g. Emby).' },
    boldness: {
      type: 'string',
      enum: ['restrained', 'expressive', 'bold'],
      description:
        "How daring the design should be, from the user's words or their answer: restrained (quiet, professional), expressive (character, depth, colour), bold (memorable, striking). Leave out when the user said nothing about it.",
    },
    goAhead: {
      type: 'boolean',
      description: 'True when the user said to just go ahead without questions.',
    },
    preferences,
  },
  additionalProperties: false,
  description:
    "The user's design intent — fill only what the user actually said or answered; leave the rest out. Without a stated look, `ask` comes back with the look question.",
};
const proposal: DesignArgumentSchema = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'kebab-case.' },
      name: { type: 'string', description: 'A short name the user can read, in their language.' },
      idea: {
        type: 'string',
        description: '"On these screens, <something only this product has> becomes <the device>."',
      },
      departs: { type: 'string', description: 'What this changes from `obvious`, and why.' },
      theme: { type: 'string', enum: ['light', 'dark'] },
      colours: {
        type: 'object',
        properties: {
          ground: { type: 'string' },
          panel: { type: 'string' },
          text: { type: 'string' },
          muted: { type: 'string' },
          accent: { type: 'string' },
          onAccent: { type: 'string' },
          extra: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Further tokens this direction needs, name → hex.',
          },
        },
        description: 'Hex colours. Omit when the brand keeps the palette.',
      },
      type: {
        type: 'object',
        properties: {
          display: { type: 'string' },
          text: { type: 'string' },
          class: {
            type: 'string',
            enum: [
              'grotesk-tight',
              'grotesk-light',
              'geometric',
              'rounded-friendly',
              'condensed-heavy',
              'extended-heavy',
              'heavy-black',
              'serif-display',
              'serif-light-large',
              'serif-text',
              'slab',
              'mono',
            ],
          },
        },
        description:
          "Font families (installable ones) and the display face's class. Omit when the brand keeps the type.",
      },
      layout: {
        type: 'string',
        description:
          'The first screen: what is largest, where it sits, how people move between screens. On a phone, name the navigation form too (floating dock, growing active tab, words only, centre action, the bar as content…), never the stock five-icon tab bar.',
      },
      radius: { type: 'number', description: 'The one corner radius in px.' },
      shell: {
        type: 'string',
        enum: ['sidebar', 'topbar', 'bottom-tabs', 'full-bleed', 'split', 'rail'],
        description:
          'How navigation and content are put together. Required for a bold design; the three options differ.',
      },
      breaks: {
        type: 'string',
        description:
          'The one default rule this option deliberately breaks, and why. Required for a bold design.',
      },
      devices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            device: {
              type: 'string',
              enum: [
                'gradient',
                'shadow',
                'glass',
                'texture',
                'mono',
                'third-face',
                'tracked-caps',
              ],
            },
            reason: { type: 'string' },
          },
          required: ['device', 'reason'],
        },
      },
    },
    required: ['id', 'name', 'idea', 'departs', 'theme', 'layout'],
  },
  description: 'propose: your three app directions.',
};

/** In DESIGN_TOOL_NAMES order. Keep all model-facing text identical to upstream. */
export const DESIGN_TOOL_SCHEMAS: readonly DesignToolSchema[] = [
  {
    name: 'vetd_create',
    description:
      "Create a new Vetta UI Design document (a `<name>.vetd/` directory holding design.json + sources) in the current workspace and open it on the design canvas. Requires the product type (or an explicit frame size) — that is what the design defaults to, so decide it from the user's request BEFORE calling. Each frames/<id>.tsx is one canvas frame AND one route — invoke the vetta-ui-design skill for the rules before writing any of them (its first steps — inventory the subject, ask what the user left open — come before this call, so load it first). Core principles — they outrank the style defaults; only the user's words outrank them (if the user asks for or clearly implies the opposite, follow the user and say in one line which one you broke): 1 one thing seen first · 2 space and alignment, not lines and boxes · 3 held objects with light, grain and an edge · 4 built from what only this product has · 5 real data, pictures and words · 6 one bold move, the rest quiet · 7 type with character and a real size step · 8 colour with a source. For a landing page or app screens also pass `brief` (and `sector` for a landing page): a landing page gets three art directions dealt to choose from with vetd_direction; app screens get the brief for proposing three directions of your own there.\nDo NOT use when the user is writing or modifying code in an existing codebase — implement the page directly in that repo's own framework instead.\nOnly for standalone visual exploration decoupled from any codebase, when the user asked for a design/mockup rather than working code.",
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Design document name (kebab-case preferred), e.g. `login-app`.',
        },
        product: {
          type: 'string',
          enum: ['mobile', 'desktop', 'watch', 'landing', 'slide', 'poster'],
          description:
            "What is being designed — sets this design's default frame size (mobile 390x844, desktop 1440x900, watch 208x248, landing 1440x2400, slide 1920x1080, poster 1080x1440). Take it from the user's request in whatever language they wrote it: a phone app is `mobile`, an Apple Watch app is `watch`, an admin console or dashboard is `desktop`. Anything else (infographic, A4 print, a square social post) goes through `frameSize` instead.",
        },
        frameSize: {
          type: 'object',
          properties: { width: { type: 'number' }, height: { type: 'number' } },
          required: ['width', 'height'],
          additionalProperties: false,
          description:
            'Explicit default size in PIXELS, for whatever `product` cannot express — the user named a size (`800x800`), or a physical format you convert yourself (A4 at 96dpi is 794x1123, at 300dpi 2480x3508). For a NAMED device (iPhone 17, iPad Pro 13, Apple Watch 46mm) call `vetd_sizes` and pass its width/height here. Wins over `product` when both are given.',
        },
        statusBar: {
          type: 'string',
          enum: ['island', 'notch', 'flat', 'none'],
          description:
            'mobile only: the iOS status bar every screen carries. Omit it unless the user said otherwise — the default is `island` (Dynamic Island). `notch` when they ask for a notch, `flat` when they want a status bar with no notch or island, `none` when they do not want a status bar at all. Stored with the design, so later screens keep it.',
        },
        interaction: {
          type: 'string',
          enum: ['mobile', 'desktop', 'other'],
          description:
            'Which kind of device the user will try this design on in interaction mode: `mobile` gets a phone body and touch gestures, `desktop` and `other` show the bare screen. Omit it — it follows `product` (mobile → mobile, desktop / landing → desktop, slide / poster → other) or, with a custom `frameSize`, the size. Pass it only when those would guess wrong (e.g. the user wants a mini-program at a custom size). Stored with the design; the user can change it afterwards, you cannot.',
        },
        brief: {
          type: 'string',
          description: 'landing / mobile / desktop: one line about the subject, in English.',
        },
        sector: { type: 'string', enum: sectors, description: 'landing: the closest sector.' },
        screens: {
          type: 'array',
          items: { type: 'string' },
          description: 'mobile / desktop: the screens to design, in your words.',
        },
        keep: {
          type: 'array',
          items: { type: 'string', enum: ['palette', 'type'] },
          description:
            'What an existing brand the user named already fixes (its colour → palette); only the rest is dealt.',
        },
        have: {
          type: 'array',
          items: { type: 'string', enum: assets },
          description:
            "Assets that really exist (the project's own photos or product photos, real UI screenshots).",
        },
        intent,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_screenshot',
    description:
      'Capture and machine-check one or more rendered design frames. Prefer `frames` or `all: true` for a multi-screen checkpoint: the tool inspects sources once, reuses one delivery capture session, and returns one contact-sheet path to Read once. The existing `frame` form remains available for a targeted recheck. Each frame reports measured/source `issues`; `stalled: true` means two consecutive captures had the same image and issues, so stop blind edits instead of trying a third cosmetic change.\nDo NOT use to capture anything that is not a frame of an open .vetd design — a dev server, a website, or an app you are building in the repo; drive those with the browser tooling instead.\nOnly for verifying frames of the design document currently open on the canvas.',
    parameters: {
      type: 'object',
      properties: {
        frame: {
          type: 'string',
          description:
            'One frame id (the frames/<id>.tsx basename), e.g. `login`. Use for a targeted recheck.',
        },
        frames: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 12,
          description:
            'Frame ids to capture as one verification batch. Prefer this after changing several screens.',
        },
        all: {
          type: 'boolean',
          description:
            'Set to true to capture every frame in the open design as one verification batch.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_status',
    description:
      'Inspect the Vetta UI Design state: workspace designs, the open design, frames, shared UI, source-only `issues`, `renderVerification`, pending notes and engine diagnostics. `issues: []` only means the source checks are clear; it is never proof that UI verification passed. `renderVerification` reports which latest captures are clean, stale, unverified, or still have measured issues. Call this once before editing an existing design; use vetd_screenshot batches for subsequent verification.\nDo NOT use to survey a code repository, locate its UI source files or read its build state — use the ordinary file search and read tools instead.\nOnly for .vetd design documents and the design canvas.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'vetd_sizes',
    description:
      'Look up the canvas\'s preset device / paper sizes: width x height in CSS px and the device\'s screen corner radius (iPhone, iPad, Apple Watch, MacBook / desktop, A4-A6). This is the SAME table the user\'s size panel on the canvas uses, so a frame you size from it matches what the user would get by clicking the preset. Call it whenever the user names a device or paper size ("iPhone 17", "iPad Pro 13 landscape", "Apple Watch 46mm", "A4") instead of recalling pixels from memory — recent devices are exactly where memory is wrong. Then declare the result in the frame meta: `export const frame = { width, height, title, radius }`, and pass the same size to `vetd_create` `frameSize` when creating the design. Do NOT use for sizes the user gave in pixels, or for product types (`product` on vetd_create covers those).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keywords, e.g. `iphone 17`, `ipad pro 13`, `watch 46`, `macbook pro 14`, `a4`. Every word must match. Omit to list the category (or everything).',
        },
        category: {
          type: 'string',
          enum: ['phone', 'desktop', 'watch', 'paper', 'ipad'],
          description: 'Narrow to one category: phone, desktop, watch, paper, ipad.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_install',
    description:
      "Install npm packages INTO this design (they land in the design's own package.json + node_modules, and travel with it). Use when a screen genuinely needs a library the design does not have — charts, markdown rendering, a rich text editor, an animation library — or a typeface (`@fontsource-variable/<slug>` / `@fontsource/<slug>`, then `@import` it at the top of theme.css). Import the package normally once this returns.\nDo NOT use to add a dependency to the user's own project, nor for icons (Iconify CSS classes are always available) or anything Tailwind utilities and plain React state already do well — run the repo's own package manager in a terminal for project dependencies instead.\nOnly for packages that frames of a .vetd design import.",
    parameters: {
      type: 'object',
      properties: {
        packages: {
          type: 'array',
          items: { type: 'string' },
          description:
            'npm package names, optionally with a version (`recharts`, `react-markdown@10`). Install everything you need in ONE call — each call is a separate npm round-trip.',
        },
        design: {
          type: 'string',
          description: 'Path to the `x.vetd/` directory (default: the design open on the canvas).',
        },
      },
      required: ['packages'],
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_notes',
    description:
      "User notes pinned on the design canvas (Figma-style comments addressed to you). No args: list PENDING notes — each with its thread, a freshly re-resolved source anchor (`element.source` = file:line, authoritative unless `anchorStale`), and per-frame screenshots where numbered pins mark note positions (numbers match `number`). `ids`: read specific notes instead. `resolve`: after fixing, reply per note to mark it resolved — this is the ONLY way to write notes; never edit .notes.json directly.\nDo NOT use for what the user wrote to you in this conversation, for code review comments or for issue trackers — act on those directly instead; and never as an end-of-turn habit on a turn that touched no .vetd design, e.g. after editing pages in the user's own codebase.\nOnly for notes pinned on the design canvas of an open .vetd design.",
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Note ids to read (default: all pending notes).',
        },
        resolve: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              reply: {
                type: 'string',
                description: "What you changed, one or two sentences, in the user's language.",
              },
            },
            required: ['id', 'reply'],
            additionalProperties: false,
          },
          description:
            'Mark notes resolved with a reply each. Only resolve notes you actually addressed.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_direction',
    description:
      'Set the art direction for a new landing page or app screens, so the look is decided instead of defaulted. Landing pages: `deal` returns three options drawn from a researched library. App screens: `propose` three directions of your own (the tool checks they avoid generated defaults and differ from each other); `deal` with `for: "app"` reprints how and some raw ingredients. Then `choose` one by id to get its direction sheet (theme.css tokens, fonts to install, composition), saved in the design as direction.json; `show` reprints it in a later turn; `redraw` re-deals one landing slot for a stated reason.\nDo NOT use when the design follows a style pack or DESIGN.md unless `keep` is ["palette","type"], for slides or posters, or for code in the user\'s own repository.\nOnly for the .vetd design open on the canvas.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['deal', 'propose', 'choose', 'show', 'redraw'] },
        for: {
          type: 'string',
          enum: ['page', 'app'],
          description:
            'deal: `page` for a landing or marketing page, `app` for screens people work in (dashboard, admin, settings, inbox).',
        },
        sector: { type: 'string', enum: sectors, description: 'deal, page: the closest sector.' },
        brief: { type: 'string', description: 'deal: one line about the subject, in English.' },
        tone: {
          type: 'string',
          enum: ['quiet', 'bold', 'warm', 'technical', 'playful', 'luxury', 'editorial'],
          description: 'deal, page: only when the user clearly asked for one.',
        },
        sections: {
          type: 'array',
          items: { type: 'string' },
          description:
            "deal, page: section roles after the hero, in the order of the page's argument (features, showcase, how-it-works, testimonial, proof, stats, pricing, faq, cta, footer, intro, about, work, gallery, list, contact).",
        },
        screens: {
          type: 'array',
          items: { type: 'string' },
          description: 'deal, app: the screens to design, in your words.',
        },
        have: {
          type: 'array',
          items: { type: 'string', enum: assets },
          description:
            "deal: assets that really exist — the project's own photography or product photos, real product-ui screenshots, an illustration set, or an image-tool you can call. Leave out what you do not have.",
        },
        keep: {
          type: 'array',
          items: { type: 'string', enum: ['palette', 'type'] },
          description:
            'deal: slots a brand, style pack or DESIGN.md already fixes; only the rest is dealt.',
        },
        intent,
        obvious: {
          type: 'string',
          description:
            'propose: the version you would make by habit for this brief — its colours, typeface and layout.',
        },
        options: proposal,
        id: { type: 'string', description: 'choose: one of the dealt or proposed ids.' },
        answers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            "choose: the user's picks for the questions in `ask`, by question id (the look answer is `id`).",
        },
        preferences,
        slot: {
          type: 'string',
          description: 'redraw (landing pages): direction, hero, type, palette, section:<role>.',
        },
        reason: {
          type: 'string',
          description:
            'redraw: why the dealt slot cannot work. propose after a choice: why the chosen direction is being replaced.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_assets',
    description:
      "Find real pictures for the open design and download them into its assets/. `search` queries free, commercially usable libraries (Unsplash photos, Openverse, Wikimedia Commons, NASA) and returns one numbered contact sheet to Read once; `get` downloads a result by `ref` — or any image `url` you found with web search — cropped to the slot's display `width`×`height`, records its credit in assets/CREDITS.json and returns the import line; `credits` lists them for your report.\nDo NOT use for images in the user's own repository, or to fetch anything that is not an image.\nOnly for the .vetd design open on the canvas.",
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'get', 'credits'] },
        query: {
          type: 'string',
          description: 'search: what is in the picture, in English ("night sky over desert").',
        },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['photos', 'openverse', 'wikimedia', 'nasa'] },
          description:
            'search: limit to these libraries (default all). photos = curated Unsplash set; nasa = space.',
        },
        orientation: { type: 'string', enum: ['landscape', 'portrait', 'square'] },
        limit: { type: 'number', description: 'search: results to return, at most 12 (default).' },
        ref: { type: 'string', description: "get: a result's ref from search." },
        url: {
          type: 'string',
          description:
            'get: any direct image URL found elsewhere (license is recorded as unverified).',
        },
        page: {
          type: 'string',
          description: 'get with url: the page the image came from, for the credit.',
        },
        width: { type: 'number', description: "get: the slot's display width in px." },
        height: { type: 'number', description: "get: the slot's display height in px." },
        name: { type: 'string', description: 'get: a short file name, e.g. `hero-desert`.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_export',
    description:
      'Export the open design as deliverable files into the current working directory: `format: "pdf"` writes one PDF with one page per frame; `format: "images"` writes one full-size PNG per frame into a `<design>-frames/` folder. Every file holds the frame\'s FULL content, including what scrolls below the frame\'s viewport. Omit `frames` to export every frame in canvas order. Existing files are never overwritten.\nExport ONE format per request, the one the user named: "export PDF" is `pdf` only, "export images" is `images` only. Never produce both in the same request — each format re-renders every frame, so doubling it doubles a slow export. If the user did not say which format, ask instead of exporting both.\nDo NOT use for design verification or to look at your own work — that is vetd_screenshot; this tool performs no checks and its output is not meant to be Read back.\nOnly for when the user asks to export, download or hand off the design as PDF or images.',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['pdf', 'images'],
          description: '`pdf`: one PDF, one page per frame. `images`: one PNG per frame.',
        },
        frames: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'Frame ids to export, in this order. Omit to export every frame (canvas order).',
        },
      },
      required: ['format'],
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_history',
    description:
      "List this design's saved versions, newest first. A version is saved automatically after every turn that changed the design, titled with what the user asked for. Use it when the user wants to go back to how the design was earlier, or asks what changed recently — then pass the chosen `version` to vetd_restore. Do NOT try to reconstruct an old version by editing files: the real content is here.",
    parameters: {
      type: 'object',
      properties: {
        design: {
          type: 'string',
          description: 'Path to the `x.vetd/` directory (default: the design open on the canvas).',
        },
        limit: { type: 'number', description: 'How many versions to return (default 30).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vetd_restore',
    description:
      "Restore the design to one of the versions from vetd_history. The files go back to how they were at that version, and the restore itself is saved as a new version — so nothing is lost and you can restore again if the user says you picked the wrong one. Call vetd_history first; never guess a version id.\nDo NOT use to undo changes in the user's own repository — that is the repo's own version control, reached through git in a terminal.\nOnly for rolling a .vetd design document back to one of its own saved versions.",
    parameters: {
      type: 'object',
      properties: {
        version: { type: 'string', description: '`version` from vetd_history.' },
        design: {
          type: 'string',
          description: 'Path to the `x.vetd/` directory (default: the design open on the canvas).',
        },
      },
      required: ['version'],
      additionalProperties: false,
    },
  },
];
