import type { ChatModelDto, EmbeddingDownloadProgressDto } from '@shared/memory/dto';
import { type SpeechModelDto, type SpeechModelId, SYSTEM_MICROPHONE } from '@shared/types/speech';
import * as React from 'react';
import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useSpeechStatus } from '@/hooks/useSpeechStatus';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useUsableProviders } from '@/stores/modelDirectory/useProviders';
import { useSettingsStore } from '@/stores/settings';
import { formatBytes } from './MemorySettings';

const MODEL_TEXT: Record<SpeechModelId, { name: string; description: string }> = {
  'x-asr-streaming': {
    name: 'X-ASR Streaming',
    description: 'Text appears while you speak. Chinese and English.',
  },
  'x-asr': {
    name: 'X-ASR',
    description: 'Most accurate on everyday speech. Chinese and English.',
  },
  'qwen3-asr': {
    name: 'Qwen3-ASR 0.6B',
    description: 'Best with mixed Chinese-English and code terms. Slower and uses more memory.',
  },
  'sense-voice': {
    name: 'SenseVoice',
    description: 'Chinese, English, Japanese, Korean and Cantonese.',
  },
  hanbao: {
    name: 'Hanbao',
    description: 'Runs fully offline. Chinese and English.',
  },
  'gemini-live': {
    name: 'Gemini Transcribe Live',
    description:
      'Google cloud recognition, most accurate with mixed Chinese-English and code terms. Needs a Gemini API key.',
  },
  wetype: {
    name: 'WeType',
    description: 'WeChat Keyboard cloud recognition. Chinese and English, no setup needed.',
  },
};

function DownloadActions({
  state,
  onDownload,
  onCancel,
  onRemove,
}: {
  state: 'missing' | 'downloading' | 'ready' | 'unavailable';
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  if (state === 'unavailable') return null;
  if (state === 'downloading') {
    return (
      <Button variant="outline" size="sm" onClick={onCancel}>
        {t('Cancel')}
      </Button>
    );
  }
  if (state === 'ready') {
    return (
      <Button variant="ghost" size="sm" onClick={onRemove}>
        {t('Remove')}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={onDownload}>
      {t('Download')}
    </Button>
  );
}

/** 识别模型单选；每项标出是否流式、下载体积与内存，并各自下载/删除 */
export function VoiceModelList() {
  const { t } = useI18n();
  const selected = useSettingsStore((state) => state.voiceModel);
  const setSelected = useSettingsStore((state) => state.setVoiceModel);
  const { status, progress, error, refresh } = useSpeechStatus();
  if (!status) return null;
  if (status.state === 'unsupported') {
    return (
      <p className="text-muted-foreground text-[calc(12rem/14)]">
        {t('Voice input is not available on this platform.')}
      </p>
    );
  }
  const api = window.electronAPI.speech;
  const detail = (model: SpeechModelDto) => {
    const current = progress[model.id];
    if (current) {
      return `${current.file} · ${formatBytes(current.received)}${
        current.total ? ` / ${formatBytes(current.total)}` : ''
      } (${current.fileIndex + 1}/${current.fileCount})`;
    }
    if (error?.modelId === model.id) return `${t('Download failed')}: ${error.message}`;
    if (model.id === 'wetype') return t('Audio is uploaded to Tencent WeChat Keyboard servers.');
    if (model.remote) {
      return model.state === 'ready'
        ? t(
            'Audio is uploaded to Google. On the free tier Google may use it to improve its products.'
          )
        : t('Enter a Gemini API key below first.');
    }
    return t('Download {{size}} · Memory about {{memory}}', {
      size: formatBytes(model.approxBytes),
      memory: formatBytes(model.memoryBytes),
    });
  };
  const selectedModel = status.models.find((model) => model.id === selected);
  return (
    <div className="space-y-1.5" data-settings-row="tools.voiceModel">
      <p className="text-[calc(13rem/14)]">{t('Speech model')}</p>
      <div role="radiogroup" className="divide-y rounded-[6px] border">
        {status.models.map((model) => {
          const active = model.id === selected;
          return (
            <div
              key={model.id}
              className={cn('flex items-center gap-3 px-3 py-2', active && 'bg-accent/40')}
            >
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(model.id)}
                className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
              >
                <span
                  className={cn(
                    'mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                    active && 'border-primary'
                  )}
                >
                  {active ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-[calc(13rem/14)]">
                    {t(MODEL_TEXT[model.id].name)}
                    {model.remote ? (
                      <Badge variant="warning" size="sm">
                        {t('Cloud')}
                      </Badge>
                    ) : null}
                    <Badge variant={model.streaming ? 'info' : 'secondary'} size="sm">
                      {model.streaming ? t('Streaming') : t('Sentence by sentence')}
                    </Badge>
                    {model.state === 'ready' && !model.remote ? (
                      <Badge variant="success" size="sm">
                        {t('Downloaded')}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-muted-foreground text-[calc(12rem/14)]">
                    {t(MODEL_TEXT[model.id].description)}
                  </span>
                  <span
                    className={cn(
                      'block text-[calc(12rem/14)]',
                      error?.modelId === model.id
                        ? 'text-destructive'
                        : model.remote
                          ? 'text-warning'
                          : 'text-muted-foreground'
                    )}
                  >
                    {detail(model)}
                  </span>
                </span>
              </button>
              <DownloadActions
                state={model.remote ? 'unavailable' : model.state}
                onDownload={() => {
                  setSelected(model.id);
                  void api.download(model.id).then(refresh);
                }}
                onCancel={() => void api.cancelDownload(model.id).then(refresh)}
                onRemove={() => void api.remove(model.id).then(refresh)}
              />
            </div>
          );
        })}
      </div>
      {status.state !== 'ready' && status.state !== 'downloading' && !selectedModel?.remote ? (
        <p className="text-muted-foreground text-[calc(12rem/14)]">
          {t('Download the selected model to start using voice input.')}
        </p>
      ) : null}
      {selectedModel?.id === 'gemini-live' ? (
        <>
          <GeminiKeySetting />
          <VoiceVocabularySetting />
        </>
      ) : null}
    </div>
  );
}

function GeminiKeySetting() {
  const { t } = useI18n();
  const value = useSettingsStore((state) => state.voiceGeminiApiKey);
  const setValue = useSettingsStore((state) => state.setVoiceGeminiApiKey);
  return (
    <div className="space-y-1.5 pt-2" data-settings-row="voice.geminiApiKey">
      <p className="text-[calc(13rem/14)]">{t('Gemini API key')}</p>
      <p className="text-muted-foreground text-[calc(12rem/14)]">
        {t('Create one for free in Google AI Studio.')}
      </p>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="AIza…"
        className="font-mono"
      />
    </div>
  );
}

function VoiceVocabularySetting() {
  const { t } = useI18n();
  const value = useSettingsStore((state) => state.voiceVocabulary);
  const setValue = useSettingsStore((state) => state.setVoiceVocabulary);
  return (
    <div className="space-y-1.5 pt-2" data-settings-row="voice.vocabulary">
      <p className="text-[calc(13rem/14)]">{t('Custom vocabulary')}</p>
      <p className="text-muted-foreground text-[calc(12rem/14)]">
        {t(
          'One term per line, up to 100. Helps with names and code terms such as useEffect or pnpm.'
        )}
      </p>
      <Textarea
        size="sm"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={'useEffect\npnpm\nTypeScript'}
        className="font-mono"
      />
    </div>
  );
}

/** 纠错开关 + 模型：本地 GGUF（与记忆共用下载）或远程 API 模型 */
export function VoiceCorrectionSettings() {
  const { t } = useI18n();
  const enabled = useSettingsStore((state) => state.voiceCorrectionEnabled);
  const setEnabled = useSettingsStore((state) => state.setVoiceCorrectionEnabled);
  const modelId = useSettingsStore((state) => state.voiceCorrectionModel) || 'remote';
  const setModelId = useSettingsStore((state) => state.setVoiceCorrectionModel);
  const remoteModel = useSettingsStore((state) => state.voiceCorrectionRemoteModel);
  const setRemoteModel = useSettingsStore((state) => state.setVoiceCorrectionRemoteModel);
  const candidates = useUsableProviders();
  const [models, setModels] = React.useState<ChatModelDto[]>([]);
  const [progress, setProgress] = React.useState<EmbeddingDownloadProgressDto | null>(null);
  const refresh = React.useCallback(() => {
    void window.electronAPI.memory.chatModels().then(setModels);
  }, []);
  React.useEffect(() => {
    refresh();
    return window.electronAPI.memory.onChatModelProgress((next) => {
      setProgress(next.done ? null : next);
      if (next.done) refresh();
    });
  }, [refresh]);

  const selected = models.find((model) => model.id === modelId) ?? null;
  const items = models.map((model) => ({
    value: model.id,
    label:
      model.id === 'remote'
        ? t('Remote (API model)')
        : `${model.label}${model.purpose ? ` · ${t('tuned for voice')}` : ''} · ${formatBytes(model.approxBytes)}`,
  }));
  const remoteProvider = remoteModel
    ? candidates.find((entry) => entry.id === remoteModel.providerId)
    : undefined;
  const remoteEntry = remoteProvider?.models.find((entry) => entry.id === remoteModel?.modelId);
  const memory = window.electronAPI.memory;

  return (
    <div className="space-y-2" data-settings-row="tools.voiceCorrection">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[calc(13rem/14)]">{t('Correct with a language model')}</p>
          <p className="text-muted-foreground text-[calc(12rem/14)]">
            {t(
              'Fixes homophones, code terms and number formats after recognition. Adds about 1-3 seconds; the raw text is kept if it fails.'
            )}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      {enabled ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[calc(13rem/14)]">{t('Correction model')}</p>
            <Select
              value={modelId}
              items={items}
              onValueChange={(value) => setModelId(String(value))}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          {selected?.downloadable ? (
            <div className="flex items-center justify-between gap-3">
              <p
                className={cn(
                  'text-[calc(12rem/14)]',
                  selected.state === 'missing' ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {progress?.modelId === selected.id
                  ? `${formatBytes(progress.received)}${
                      progress.total ? ` / ${formatBytes(progress.total)}` : ''
                    }`
                  : selected.state === 'ready'
                    ? t('Model downloaded')
                    : selected.state === 'downloading'
                      ? t('Downloading…')
                      : t('Not downloaded yet. Correction is skipped until it is.')}
              </p>
              <DownloadActions
                state={selected.state}
                onDownload={() => void memory.downloadChatModel(selected.id).then(refresh)}
                onCancel={() => void memory.cancelChatModelDownload(selected.id).then(refresh)}
                onRemove={() => void memory.deleteChatModel(selected.id).then(refresh)}
              />
            </div>
          ) : null}
          {modelId === 'remote' && candidates.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-[calc(12rem/14)]">
                {t('A fast, inexpensive model is enough.')}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                {remoteModel ? (
                  <Button variant="ghost" size="sm" onClick={() => setRemoteModel(null)}>
                    {t('Reset')}
                  </Button>
                ) : null}
                <div className="w-56">
                  <ModelPicker
                    providers={candidates}
                    providerId={remoteProvider?.id ?? ''}
                    modelId={remoteEntry?.id ?? ''}
                    reasoningEnabled={false}
                    thinkingLevel="medium"
                    showReasoningControls={false}
                    emptyLabel={t('Follows the title-summary model')}
                    side="bottom"
                    triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
                    onSelect={(providerId, id) => setRemoteModel({ providerId, modelId: id })}
                    onReasoningChange={() => {}}
                    onThinkingChange={() => {}}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function VoiceInputSettings() {
  const { t } = useI18n();
  const enabled = useSettingsStore((state) => state.voiceInputEnabled);
  const setEnabled = useSettingsStore((state) => state.setVoiceInputEnabled);
  return (
    <div className="space-y-[24px]" data-slot="settings-page">
      <div className="flex items-start justify-between gap-4" data-settings-row="voice.root">
        <div>
          <h3 className="font-semibold text-[calc(18rem/14)] leading-[calc(26rem/14)]">
            {t('Voice input')}
          </h3>
          <p className="text-muted-foreground text-[calc(13rem/14)]">
            {t(
              'Adds a microphone to the composer on this computer and on paired phones. Local models transcribe speech on this computer.'
            )}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t('Voice input')}
          className="mt-1 shrink-0"
        />
      </div>
      {enabled ? (
        <>
          <MicrophoneSetting />
          <VoiceModelList />
          <VoiceCorrectionSettings />
        </>
      ) : null}
    </div>
  );
}

/** 本机输入设备，插拔时刷新；'default' / 'communications' 是系统别名，用「跟随系统」代替 */
function useMicrophones(): MediaDeviceInfo[] {
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  React.useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let alive = true;
    const load = () =>
      void media.enumerateDevices().then((all) => {
        if (!alive) return;
        setDevices(
          all.filter(
            (device) =>
              device.kind === 'audioinput' &&
              device.deviceId !== SYSTEM_MICROPHONE &&
              device.deviceId !== 'communications'
          )
        );
      });
    load();
    media.addEventListener('devicechange', load);
    return () => {
      alive = false;
      media.removeEventListener('devicechange', load);
    };
  }, []);
  return devices;
}

function MicrophoneSetting() {
  const { t } = useI18n();
  const deviceId = useSettingsStore((state) => state.voiceInputDevice);
  const setDeviceId = useSettingsStore((state) => state.setVoiceInputDevice);
  const devices = useMicrophones();
  const items = [
    { value: SYSTEM_MICROPHONE, label: t('System default') },
    ...devices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || t('Microphone {{n}}', { n: index + 1 }),
    })),
  ];
  if (!items.some((item) => item.value === deviceId)) {
    items.push({ value: deviceId, label: t('Disconnected, using the system default') });
  }
  return (
    <div className="flex items-center justify-between gap-3" data-settings-row="voice.microphone">
      <p className="text-[calc(13rem/14)]">{t('Microphone')}</p>
      <Select value={deviceId} items={items} onValueChange={(value) => setDeviceId(String(value))}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
