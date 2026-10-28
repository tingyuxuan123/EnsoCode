import { useEffect, useState } from 'react';
import { Segmented, Spinner } from '../../Controls';
import { InlineNotice, outlineButton, SettingsHeader, SettingsRow, SettingsSection } from '../SettingsUI';
import { ModelSelect, Select, SwitchLine } from './shared';

type ModelState = 'missing' | 'downloading' | 'ready' | 'failed';
const MODELS = [
  { id: 'x-asr-streaming', name: 'X-ASR Streaming', desc: '边说边出字，支持中文和英文。', streaming: true, remote: false, size: '186 MB', memory: '320 MB' },
  { id: 'x-asr', name: 'X-ASR', desc: '日常说话识别最准，支持中文和英文。', streaming: false, remote: false, size: '214 MB', memory: '360 MB' },
  { id: 'qwen3-asr', name: 'Qwen3-ASR 0.6B', desc: '中英混说和代码术语识别最好，但较慢且更占内存。', streaming: false, remote: false, size: '940 MB', memory: '1.6 GB' },
  { id: 'sense-voice', name: 'SenseVoice', desc: '支持中文、英文、日语、韩语和粤语。', streaming: false, remote: false, size: '228 MB', memory: '410 MB' },
  { id: 'hanbao', name: '憨包', desc: '完全离线运行，支持中文和英文。', streaming: false, remote: false, size: '95 MB', memory: '180 MB' },
  { id: 'gemini-live', name: 'Gemini Transcribe Live', desc: 'Google 云端识别，中英混说和代码术语最准。需要 Gemini API Key。', streaming: true, remote: true, size: '', memory: '' },
  { id: 'wetype', name: 'WeType', desc: '微信输入法云端识别，支持中文和英文，无需配置。', streaming: false, remote: true, size: '', memory: '' },
];

/** 语音输入（VoiceInputSettings） */
export function VoicePage() {
  const [platform, setPlatform] = useState<'mac' | 'unsupported'>('mac');
  const [enabled, setEnabled] = useState(true);
  const [selected, setSelected] = useState('qwen3-asr');
  const [states, setStates] = useState<Record<string, ModelState>>({ 'qwen3-asr': 'ready', 'x-asr-streaming': 'missing', 'x-asr': 'failed', 'sense-voice': 'missing', hanbao: 'missing' });
  const [progress, setProgress] = useState(0);
  const [mic, setMic] = useState('missing-usb');
  const [geminiKey, setGeminiKey] = useState('');
  const [words, setWords] = useState('pnpm\nuseEffect\nEnsoCode\nworktree');
  const [correct, setCorrect] = useState(true);
  const [correctModel, setCorrectModel] = useState('');
  const downloading = Object.entries(states).find(([, value]) => value === 'downloading')?.[0];
  useEffect(() => {
    if (!downloading) return;
    if (progress >= 100) { setStates((prev) => ({ ...prev, [downloading]: 'ready' })); setProgress(0); return; }
    const timer = window.setTimeout(() => setProgress(progress + 12), 300);
    return () => window.clearTimeout(timer);
  }, [downloading, progress]);
  const model = MODELS.find((item) => item.id === selected)!;
  const ready = model.remote ? (model.id === 'wetype' || Boolean(geminiKey)) : states[selected] === 'ready';
  return (
    <div data-settings-row="voice.root">
      <SettingsHeader title="语音输入" description="在本机和已配对手机的输入框中显示麦克风按钮，本地模型在这台电脑上识别语音。" actions={<Segmented size="sm" label="平台预览" value={platform} onChange={setPlatform} options={[{ value: 'mac', label: 'macOS' }, { value: 'unsupported', label: '不支持的平台' }]} />} />
      {platform === 'unsupported' ? (
        <InlineNotice tone="warning">当前平台不支持语音输入。</InlineNotice>
      ) : (
        <>
          <SettingsSection>
            <SwitchLine label="语音输入" description="开启后输入框显示麦克风按钮；按住快捷键说话，松开后文字进入输入框。" checked={enabled} onChange={setEnabled} />
          </SettingsSection>
          <div className={enabled ? '' : 'pointer-events-none opacity-50'}>
            <SettingsSection title="识别模型" description={ready ? undefined : '下载所选模型后即可使用语音输入。'}>
              <div className="divide-y divide-line rounded-control border border-line">
                {MODELS.map((item) => {
                  const state = states[item.id];
                  return (
                    <label key={item.id} className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${selected === item.id ? 'bg-selected' : 'hover:bg-hover'}`}>
                      <input type="radio" name="speech-model" checked={selected === item.id} onChange={() => setSelected(item.id)} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                          {item.name}
                          {item.remote && <span className="rounded-[4px] bg-control px-1.5 text-[11px] font-normal text-muted">云端</span>}
                          <span className="rounded-[4px] bg-control px-1.5 text-[11px] font-normal text-muted">{item.streaming ? '流式' : '逐句'}</span>
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted">{item.desc}</p>
                        {!item.remote && <p className="mt-0.5 text-[11px] text-faint">下载 {item.size} · 内存约 {item.memory}</p>}
                        {item.id === 'wetype' && <p className="mt-0.5 text-[11px] text-warning">音频会上传到腾讯微信输入法服务器。</p>}
                        {item.id === 'gemini-live' && <p className="mt-0.5 text-[11px] text-warning">音频会上传到 Google；免费层级下 Google 可能用它改进产品。{!geminiKey && ' 需先在下方填写 Gemini API Key。'}</p>}
                        {state === 'downloading' && (
                          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
                            <span className="h-1 w-40 overflow-hidden rounded-full bg-control"><span className="block h-full bg-primary" style={{ width: `${progress}%` }} /></span>
                            下载中… {progress}%
                          </div>
                        )}
                        {state === 'failed' && <p className="mt-1 text-[11px] text-danger">下载失败：网络连接中断。</p>}
                      </div>
                      {!item.remote && (
                        <span className="flex shrink-0 items-center gap-2" onClick={(event) => event.preventDefault()}>
                          {state === 'ready' && <span className="flex items-center gap-1 text-[11px] text-success"><span className="icon-[lucide--circle-check] size-3.5" />已下载</span>}
                          {state === 'ready' && <button onClick={() => setStates({ ...states, [item.id]: 'missing' })} className="text-[12px] text-muted hover:text-danger">移除</button>}
                          {state === 'downloading' && <button onClick={() => { setStates({ ...states, [item.id]: 'missing' }); setProgress(0); }} className="flex items-center gap-1 text-[12px] text-muted"><Spinner className="size-3" />取消</button>}
                          {(state === 'missing' || state === 'failed') && <button disabled={Boolean(downloading)} onClick={() => setStates({ ...states, [item.id]: 'downloading' })} className={outlineButton}>{state === 'failed' ? '重试' : '下载'}</button>}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {selected === 'gemini-live' && (
                <div className="mt-3">
                  <p className="text-[13px]">Gemini API Key</p>
                  <p className="text-[12px] text-muted">可在 Google AI Studio 免费创建。</p>
                  <input type="password" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} placeholder="AIza…" aria-label="Gemini API Key" className="mt-1.5 h-8 w-80 rounded-control border border-border bg-input px-2 font-mono text-[12px] outline-none focus:border-primary/60" />
                </div>
              )}
            </SettingsSection>
            <SettingsSection title="麦克风">
              <SettingsRow label="录音设备" description={mic === 'missing-usb' ? <span className="text-warning">已断开，暂用系统默认</span> : undefined}>
                <Select label="麦克风" value={mic} onChange={setMic} width="w-56" options={[['default', '系统默认'], ['builtin', 'MacBook Pro 麦克风'], ['missing-usb', 'Shure MV7（已断开）']]} />
              </SettingsRow>
            </SettingsSection>
            <SettingsSection title="自定义词表" description="每行一个，最多 100 个。可提升人名和 useEffect、pnpm 这类代码术语的识别率。">
              <textarea value={words} onChange={(event) => setWords(event.target.value)} aria-label="自定义词表" className="h-24 w-full rounded-control border border-border bg-input p-2.5 font-mono text-[12px] leading-5 outline-none focus:border-primary/60" />
              <p className="mt-1 text-right text-[11px] tabular-nums text-faint">{words.split('\n').filter(Boolean).length} / 100</p>
            </SettingsSection>
            <SettingsSection title="语音纠错专用">
              <SwitchLine label="用大模型纠错" description="识别后纠正同音错字、代码术语和数字写法，约多 1–3 秒；纠错失败时保留原文。" checked={correct} onChange={setCorrect} />
              {correct && (
                <SettingsRow label="纠错模型" description="选一个快且便宜的模型即可。">
                  <ModelSelect label="纠错模型" value={correctModel} onChange={setCorrectModel} emptyLabel="跟随标题模型" allowVirtual={false} />
                  {correctModel && <button onClick={() => setCorrectModel('')} className="text-[12px] text-muted">重置</button>}
                </SettingsRow>
              )}
            </SettingsSection>
          </div>
        </>
      )}
    </div>
  );
}
