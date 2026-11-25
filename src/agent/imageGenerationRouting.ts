/** Describe only capabilities actually offered to this request; never force a tool or weaken gates. */
export function imageGenerationRouting(active: ReadonlySet<string>): string | undefined {
  const rules: string[] = [];
  if (active.has('generate_image')) {
    rules.push(
      'Use generate_image for requests to draw or generate an actual image, illustration, wallpaper, character artwork or poster (海报). A poster is not automatically an editable design document. For example, “画一张 4K 16:9 海报” / “draw a 4K 16:9 poster” requests a generated picture: use generate_image with size 3840x2160, not vetd_create, TSX, HTML, SVG, canvas code or a design subagent as a substitute. Expand the requested subject/style into the prompt and use sensible defaults; do not load a UI design skill merely because the user said poster.'
    );
    if (active.has('vetd_create'))
      rules.push(
        'Use the vetta-ui-design skill and vetd_* tools for editable layouts, typography/infographic compositions, slides, UI mockups or .vetd sources. For a visual UI redesign request, explicitly selecting vetta-ui-design counts as asking for a canvas draft, even when the reference is an existing app or plugin. Keep normal front-end implementation in the existing repository. Selecting a skill or opening a canvas does not turn an explicit request for a generated picture into a canvas task.'
      );
  }
  if (active.has('edit_image'))
    rules.push(
      'Use edit_image for a user-requested generative modification of an existing picture, passing its image id or workspace source path. Do not substitute a new design canvas for that edit.'
    );
  if (rules.length === 0) return undefined;
  rules.push(
    'Call image tools directly, not via codemode or a subagent. Respect approval and planning restrictions. Each image call may be billed: never auto-retry, silently change providers, or claim success without a successful tool result.'
  );
  return rules.join('\n\n');
}
