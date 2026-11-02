export function analyze(text) {
  return {
    words: text.match(/[\p{L}\p{N}_'-]+/gu)?.length ?? 0,
    lines: text === '' ? 0 : text.split(/\r?\n/).length,
    chars: [...text].length,
  };
}
export function activate(enso) {
  enso.tools.register('count_words', async (args) => {
    if (typeof args.text !== 'string') throw new Error('text must be a string');
    const stats = analyze(args.text);
    return {
      content: Object.entries(stats)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
      details: stats,
    };
  });
}
