export function onLoad(enso) {
  const h = enso.React.createElement;
  const style = {
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 10,
    whiteSpace: 'pre-wrap',
    fontSize: 12,
  };
  enso.slots.register({
    slot: 'tool.card',
    toolName: 'count_words',
    component: ({ output }) => h('div', { style }, output ?? 'Waiting…'),
  });
  enso.slots.register({
    slot: 'block',
    language: 'bars',
    component: ({ source }) => {
      const rows = source
        .split('\n')
        .slice(0, 20)
        .map((line) => /^(.{1,60}):\s*(\d{1,6})$/.exec(line))
        .filter(Boolean);
      const max = Math.max(1, ...rows.map((row) => Number(row[2])));
      return h(
        'div',
        { style },
        ...rows.map((row) =>
          h(
            'div',
            { key: row[1], style: { margin: '4px 0' } },
            `${row[1]}: ${row[2]}`,
            h('div', {
              style: {
                height: 5,
                width: `${(Number(row[2]) / max) * 100}%`,
                background: 'var(--brand)',
              },
            })
          )
        )
      );
    },
  });
}
