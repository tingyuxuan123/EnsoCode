const commands = {
  pages: [0, 0],
  eval: [1, 1],
  shot: [0, 1],
  keys: [1, Infinity],
  type: [1, 1],
  drag: [2, 2],
  ready: [0, 1],
  click: [1, 1],
  'session-new': [1, 1],
  'session-send': [2, 2],
  'session-wait': [1, 1],
  'session-read': [1, 1],
};

function integer(value, min, max, label) {
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max)
    throw new Error(`INVALID_${label}: ${value}`);
  return Number(value);
}

export function parseArgs(argv, env = process.env) {
  const [command, ...args] = argv;
  if (!Object.hasOwn(commands, command ?? ''))
    throw new Error(
      'USAGE: pages|eval|shot|keys|type|drag|ready|click|session-new|session-send|session-wait|session-read'
    );
  const result = {
    command,
    rest: [],
    page: 'index.html',
    port: integer(env.ENSO_CDP_PORT?.trim() || '9222', 1, 65535, 'PORT'),
    timeout: 30_000,
    button: 'left',
  };
  const options = {
    '--page': 'page',
    '--timeout': 'timeout',
    '--button': 'button',
    '--provider-id': 'providerId',
    '--model-id': 'modelId',
    '--after-seq': 'afterSeq',
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      result.rest.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--allow-default-profile') {
      result.allowDefaultProfile = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      result.rest.push(arg);
      continue;
    }
    const key = options[arg];
    if (!key || seen.has(key) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error(`INVALID_OPTION: ${arg}`);
    seen.add(key);
    result[key] = args[++i];
  }
  const [min, max] = commands[command];
  if (result.rest.length < min || result.rest.length > max)
    throw new Error(`USAGE: ${command} (received ${result.rest.length} arguments)`);
  result.timeout = integer(result.timeout, 1, 300_000, 'TIMEOUT');
  if (result.afterSeq !== undefined)
    result.afterSeq = integer(result.afterSeq, 0, Number.MAX_SAFE_INTEGER, 'SEQ');
  if (!['left', 'right'].includes(result.button)) throw new Error('INVALID_BUTTON: left|right');
  if (Boolean(result.providerId) !== Boolean(result.modelId))
    throw new Error('MODEL_SELECTION: supply both --provider-id and --model-id');
  if ((seen.has('providerId') || seen.has('modelId')) && command !== 'session-send')
    throw new Error('MODEL_SELECTION: only session-send accepts model options');
  if (seen.has('afterSeq') && command !== 'session-wait')
    throw new Error('INVALID_OPTION: --after-seq is for session-wait');
  if (seen.has('button') && command !== 'click')
    throw new Error('INVALID_OPTION: --button is for click');
  if (
    ['session-new', 'session-send'].includes(command) &&
    result.port === 9222 &&
    !result.allowDefaultProfile
  )
    throw new Error(
      'DEFAULT_PROFILE_WRITE_BLOCKED: use ENSO_CDP_PORT=9333 for isolation, or explicitly --allow-default-profile'
    );
  return result;
}

export function selectPage(list, filter) {
  if (!Array.isArray(list)) throw new Error('CDP_UNREACHABLE: invalid target list');
  const pages = list.filter((target) => target?.type === 'page');
  const matches = pages.filter(
    (target) => typeof target.url === 'string' && target.url.includes(filter)
  );
  if (!matches.length)
    throw new Error(
      `NO_PAGE: ${JSON.stringify(filter)}; pages: ${pages.map((p) => p.url).join(', ')}`
    );
  if (matches.length !== 1)
    throw new Error(
      `AMBIGUOUS_PAGE: ${matches.length} targets match ${JSON.stringify(filter)}; use a more specific --page`
    );
  return matches[0];
}

export async function deadline(work, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(port, path, { fetchImpl = fetch, timeout = 5000 } = {}) {
  integer(port, 1, 65535, 'PORT');
  if (!['/json/list', '/json/version'].includes(path)) throw new Error('INVALID_CDP_ENDPOINT');
  const controller = new AbortController();
  try {
    return await deadline(
      async () => {
        const response = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
          signal: controller.signal,
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      },
      timeout,
      'HTTP_TIMEOUT'
    );
  } catch (error) {
    throw new Error(
      `CDP_UNREACHABLE (${port}): ${error.message}; start/restart pnpm dev (packaged CDP stays closed)`
    );
  } finally {
    controller.abort();
  }
}

export function connect(url, { WebSocketImpl = WebSocket, timeout = 15_000, expectedPort } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
      if (
        parsed.protocol !== 'ws:' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
        parsed.username ||
        parsed.password ||
        (expectedPort && Number(parsed.port) !== expectedPort)
      )
        throw new Error('CDP_LOOPBACK_REQUIRED: target must use the selected loopback port');
      integer(parsed.port, 1, 65535, 'PORT');
    } catch (error) {
      reject(error);
      return;
    }
    const ws = new WebSocketImpl(parsed.href);
    let id = 0;
    let closed;
    let opened = false;
    const pending = new Map();
    const fail = (error) => {
      if (closed) return;
      closed = error;
      clearTimeout(openTimer);
      reject(error);
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(error);
      }
      pending.clear();
      ws.close();
    };
    const openTimer = setTimeout(() => fail(new Error('CDP_CONNECT_TIMEOUT')), timeout);
    ws.addEventListener('error', () => fail(new Error('CDP_SOCKET_ERROR')));
    ws.addEventListener('close', () => fail(new Error('CDP_SOCKET_CLOSED')));
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        fail(new Error('CDP_INVALID_JSON'));
        return;
      }
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(`CDP_RPC_ERROR: ${message.error.message}`));
      else item.resolve(message);
    });
    ws.addEventListener('open', () => {
      if (closed || opened) return;
      opened = true;
      clearTimeout(openTimer);
      resolve({
        close: () => fail(new Error('CDP_SOCKET_CLOSED')),
        send(method, params = {}) {
          if (closed) return Promise.reject(closed);
          return new Promise((res, rej) => {
            const next = ++id;
            const timer = setTimeout(() => {
              pending.delete(next);
              rej(
                new Error(
                  `CDP_RPC_TIMEOUT: ${method}; outcome may be unknown; do not retry mutations`
                )
              );
            }, timeout);
            pending.set(next, { resolve: res, reject: rej, timer });
            try {
              ws.send(JSON.stringify({ id: next, method, params }));
            } catch (error) {
              fail(error);
            }
          });
        },
      });
    });
  });
}

export async function waitUntil(probe, { timeout = 30_000, interval = 100 } = {}) {
  return deadline(
    async () => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const result = await probe();
        if (result) return result;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(interval, Math.max(0, end - Date.now())))
        );
      }
      throw new Error('WAIT_TIMEOUT');
    },
    timeout,
    'WAIT_TIMEOUT'
  );
}
