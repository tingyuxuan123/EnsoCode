export function onLoad(enso) {
  const h = enso.React.createElement;
  const style = {
    border: 'none',
    background: 'transparent',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    padding: '3px 6px',
    fontSize: 12,
  };
  const insert = async (text) => {
    const snapshot = await enso.composer.readDraft();
    await enso.composer.insertText({ text, expect: snapshot });
  };
  const button = (title, text) =>
    h(
      'button',
      {
        type: 'button',
        title,
        style,
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => void insert(text).catch((error) => console.warn(error.code, error.message)),
      },
      title
    );
  enso.slots.register({
    slot: 'composer.right',
    component: ({ busy }) =>
      busy ? null : button('插入时间', `[${new Date().toLocaleDateString()}] `),
  });
  enso.slots.register({
    slot: 'message.action',
    position: 'right',
    component: ({ text }) =>
      button(
        '引用',
        `\n${text
          .slice(0, 8000)
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')}\n`
      ),
  });
}
