/**
 * 需求助手仅注册 build_report 结果工具卡，侧栏由用户手动打开。
 * 自包含、无外部依赖；不自动保存、不自动写表，异常一律显示在界面上。
 */

const MAX_TEXT = 8000;
const LABELS = {
  not_tested: '未测试',
  cannot_reproduce: '无法复现',
  local_passed: '本地通过',
  test_env_passed: '测试环境通过',
};
const asText = (value) => (value === null || value === undefined ? '' : String(value));
const clip = (value) =>
  value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}\n…（内容较长，已截断显示）` : value;
const stepsText = (value) =>
  Array.isArray(value) ? value.map(asText).filter(Boolean).join('\n') : asText(value);

const errorText = (error) => {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  const message = error.message ? String(error.message) : String(error);
  return error.code ? `${message}（${error.code}）` : message;
};

const failed = (result) => (result && typeof result.error === 'string' ? result.error : '');

/** 工具输出按约定是 JSON 文本；结构不齐时只提示重新生成，不猜测内容。 */
const parseOutput = (output) => {
  if (typeof output !== 'string' || !output.trim()) return { kind: 'empty' };
  let parsed = null;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = null;
  }
  const report = parsed && typeof parsed === 'object' ? parsed.report : null;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { kind: 'invalid', reason: '这段结果不完整，请让 Agent 重新生成一次。' };
  }
  const summary = asText(report.summary).trim();
  const steps = stepsText(report.steps).trim();
  return { kind: 'ok', parsed, summary, steps, verification: asText(report.verification) };
};

const styles = {
  card: { display: 'flex', flexDirection: 'column', gap: 6, padding: 10, fontSize: 12 },
  frame: { border: '1px solid var(--border)', borderRadius: 6 },
  head: { display: 'flex', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 12, fontWeight: 600 },
  badge: { padding: '0 6px', fontSize: 11, border: '1px solid var(--border)' },
  muted: { color: 'var(--muted-foreground)' },
  steps: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 },
  actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  button: { padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer' },
  error: { color: 'var(--destructive)', fontSize: 11.5 },
  note: { color: 'var(--muted-foreground)', fontSize: 11 },
};

/** 宿主 PluginOnLoad：返回撤销全部挂点的清理函数（可重复调用）。 */
export const onLoad = (enso) => {
  const { React } = enso;
  const h = React.createElement;
  const disposers = [];
  const cardStyle = { ...styles.card, ...styles.frame };
  const call = (method, args) =>
    enso.dispatch('plugin.call', { method, args: args === undefined ? {} : args });
  const btn = (label, props) => h('button', { type: 'button', ...props }, label);
  const line = (style, value) => h('div', { style }, value);
  const btnStyle = (disabled) => ({
    ...styles.button,
    ...styles.frame,
    ...(disabled ? { opacity: 0.5 } : {}),
  });

  const BuildReportCard = ({ output }) => {
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState('');
    const parsed = React.useMemo(() => parseOutput(output), [output]);
    const openResult = async () => {
      setPending(true);
      setError('');
      try {
        const saved = await call('save_report', { candidate: parsed.parsed });
        if (failed(saved)) throw new Error(failed(saved));
        const opened = await call('open_view');
        if (failed(opened)) throw new Error(failed(opened));
      } catch (reason) {
        setError(`${errorText(reason)}；没有保存，可以再点一次。`);
      } finally {
        setPending(false);
      }
    };
    if (parsed.kind === 'empty') return h('div', { style: cardStyle }, line(null, '等待结果…'));
    const label = LABELS[parsed.verification] || '未测试';
    const head = h(
      'div',
      { style: styles.head },
      h('span', { style: styles.title }, '处理结果'),
      parsed.kind === 'ok' ? h('span', { style: styles.badge }, label) : null
    );
    if (parsed.kind === 'invalid') {
      return h(
        'div',
        { style: cardStyle },
        head,
        line(styles.note, parsed.reason),
        line(styles.note, '没有保存任何内容。')
      );
    }
    return h(
      'div',
      { style: cardStyle },
      head,
      line(null, parsed.summary || '（没有填写处理说明）'),
      parsed.steps
        ? line(styles.steps, clip(parsed.steps))
        : line(styles.note, '（没有填写复测步骤）'),
      h(
        'div',
        { style: styles.actions },
        btn(pending ? '保存中…' : '查看结果', {
          disabled: pending,
          style: btnStyle(pending),
          onClick: () => void openResult(),
        }),
        line(styles.note, '保存到本机并打开需求助手；不会写入表格。')
      ),
      error ? line(styles.error, error) : null
    );
  };

  disposers.push(
    enso.slots.register({ slot: 'tool.card', toolName: 'build_report', component: BuildReportCard })
  );

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch (reason) {
        console.warn('[kdocs-tasks] cleanup failed', reason);
      }
    }
  };
};
