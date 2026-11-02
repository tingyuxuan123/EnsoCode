const snippets = [
  { id: 'review', label: 'review', text: '请审查正确性、边界条件和遗漏的测试。' },
  { id: 'tests', label: 'tests', text: '先添加失败测试，再给出最小实现。' },
];
export function activate(enso) {
  enso.triggers.register('snippet', {
    candidates: async (query) =>
      snippets
        .filter((item) => item.label.includes(query.toLowerCase()))
        .map(({ id, label, text }) => ({ id, label, detail: text })),
    pick: async (item) => snippets.find((snippet) => snippet.id === item.id)?.text ?? '',
  });
}
