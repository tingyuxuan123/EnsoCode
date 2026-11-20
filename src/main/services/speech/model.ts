import path from 'node:path';
import {
  DEFAULT_SPEECH_MODEL_ID,
  isSpeechModelId,
  SPEECH_SAMPLE_RATE,
  type SpeechModelId,
} from '@shared/types/speech';
import type { DownloadableModel } from '../llama/downloader';

/** 仅 GitHub Release 提供的整包（HF/ModelScope 无单文件），解压后按 files 校验 */
export interface SpeechModelArchive {
  url: string;
  sha256: string;
  bytes: number;
  /** 包内顶层目录，files 相对于它 */
  root: string;
}

export interface SpeechModelSpec extends DownloadableModel {
  id: SpeechModelId;
  streaming: boolean;
  /** 下载体积 */
  approxBytes: number;
  /** 实测（M4，2026-09）加载后进程 RSS 增量的量级 */
  memoryBytes: number;
  archive?: SpeechModelArchive;
  /** 云端识别，凭证来自已配置的服务商 */
  remote?: true;
}

const X_ASR_STREAMING_ROOT =
  'sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05';
const X_ASR_TOKENS = {
  name: 'tokens.txt',
  sha256: 'b818a60878b9aae978cbb8ad594acbd403d76d1af2e31ef4197c84e2dbdba27c',
};

/**
 * 语音模型注册表。实测（96 条，2026-09）：X-ASR 真人 CER 1.86%、流式 160ms 版 2.61% 且约 0.8s 出首字；
 * Qwen3-ASR 中英混合/代码术语最好但慢且吃内存；SenseVoice 保留给日/韩/粤语。
 * sha256 取自 HF LFS oid / GitHub Release digest；非 LFS 小文件为本地核对值。
 */
export const SPEECH_MODELS: Record<SpeechModelId, SpeechModelSpec> = {
  'x-asr-streaming': {
    id: 'x-asr-streaming',
    streaming: true,
    approxBytes: 133_898_007,
    memoryBytes: 1024 ** 3,
    files: [
      {
        name: 'encoder.int8.onnx',
        sha256: '68633dced8b8891be5b9309496cd939bbeba9188f1c1774957196f11a491aa25',
      },
      {
        name: 'decoder.onnx',
        sha256: 'a1cbc9eac2d5e3fb6617a218c67ad6daaa7f4e0fd225f08b2c22ab0413c8c257',
      },
      {
        name: 'joiner.int8.onnx',
        sha256: 'aedb7fa697b2ab43f20499826fff7c997eea7d67db77be97769aeeeb726e63b3',
      },
      X_ASR_TOKENS,
    ],
    sources: null,
    archive: {
      url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${X_ASR_STREAMING_ROOT}.tar.bz2`,
      sha256: '8a6fca056e1a342546edd78be4d50274e2c01898e7b8ae8fc336f6410319c399',
      bytes: 133_898_007,
      root: X_ASR_STREAMING_ROOT,
    },
  },
  'x-asr': {
    id: 'x-asr',
    streaming: false,
    approxBytes: 175_693_762,
    memoryBytes: 900 * 1024 ** 2,
    files: [
      {
        name: 'encoder-epoch-99-avg-1.int8.onnx',
        sha256: 'fe0198b52626f2a1012ebb6d6a7259c5137c4c964f3a524135e353f4687b5d14',
      },
      {
        name: 'decoder-epoch-99-avg-1.onnx',
        sha256: 'a9fe7c320337e6f510809c028a8accf074d45f42aab852e2d29830babc41a3f9',
      },
      {
        name: 'joiner-epoch-99-avg-1.int8.onnx',
        sha256: 'aedb7fa697b2ab43f20499826fff7c997eea7d67db77be97769aeeeb726e63b3',
      },
      X_ASR_TOKENS,
    ],
    sources: {
      huggingface: 'csukuangfj2/sherpa-onnx-x-asr-zipformer-transducer-zh-en-punct-int8-2026-06-03',
      modelscope: null,
    },
  },
  'qwen3-asr': {
    id: 'qwen3-asr',
    streaming: false,
    approxBytes: 987_015_347,
    memoryBytes: 2.3 * 1024 ** 3,
    files: [
      {
        name: 'conv_frontend.onnx',
        sha256: 'd22dc4423e0940e49884e903d2ea2f7e5567c14fc1aed97e4e26d6b8f208ef9e',
      },
      {
        name: 'encoder.int8.onnx',
        sha256: '60748d3e6744a57c9c91e1b17424a6c2990567e8adceb0783940c03ed98fa9d9',
      },
      {
        name: 'decoder.int8.onnx',
        sha256: '4f6885be5959ae26af3089d38ee7972c5fafbeeb1cf8d5e76eab6d8b61ca5771',
      },
      {
        name: 'tokenizer/merges.txt',
        sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5',
      },
      {
        name: 'tokenizer/tokenizer_config.json',
        sha256: '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c',
      },
      {
        name: 'tokenizer/vocab.json',
        sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910',
      },
    ],
    sources: {
      huggingface: 'csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
      modelscope: null,
    },
  },
  /** SenseVoice int8：中英日韩粤，自带标点与反正则化；ModelScope 为同文件镜像 */
  'sense-voice': {
    id: 'sense-voice',
    streaming: false,
    approxBytes: 239_549_735,
    memoryBytes: 900 * 1024 ** 2,
    files: [
      {
        name: 'model.int8.onnx',
        sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
      },
      {
        name: 'tokens.txt',
        sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
      },
    ],
    sources: {
      huggingface: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
      modelscope: 'pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
    },
  },
  /** 憨包离线引擎（仅 macOS arm64）：选中下载时先装 HANBAO_ENGINE，模型取自按 MD5 寻址的 CDN */
  hanbao: {
    id: 'hanbao',
    streaming: true,
    approxBytes: 185_377_526,
    memoryBytes: 900 * 1024 ** 2,
    files: [
      {
        name: 'model.flute',
        sha256: '3a46e175f322822f368d970580271888383cc571996776754a17af669b48867d',
        urls: ['lf3', 'lf26'].map(
          (host) =>
            `https://${host}-effectcdn-tos.byteeffecttos.com/obj/ies.fe.effect/b78e55b937a6f7da432097d2d9dc7214?module=model`
        ),
      },
    ],
    sources: null,
  },
  'gemini-live': {
    id: 'gemini-live',
    streaming: true,
    approxBytes: 0,
    memoryBytes: 0,
    files: [],
    sources: null,
    remote: true,
  },
  /** 微信输入法云端识别，无需凭证（服务端现场签发 UIN） */
  wetype: {
    id: 'wetype',
    streaming: true,
    approxBytes: 0,
    memoryBytes: 0,
    files: [],
    sources: null,
    remote: true,
  },
};

/** hanbao 预编译（源码私有）挂在 EnsoCode v0.2.1 Release；升级时换 URL、哈希和目录版本 */
export const HANBAO_ENGINE: SpeechModelSpec = {
  id: 'hanbao',
  streaming: true,
  approxBytes: 3_354_443,
  memoryBytes: 0,
  files: [
    { name: 'hanbao', sha256: 'ec016c6f249e8e5d0fe4437d8612240f235c931ed11ca996f38c47d5062660f8' },
    {
      name: 'libs/libaudioeffect.so',
      sha256: '5303cab48de6ef5db6ace4d54779b0e64f9e2eb6a2600dd41638f6d9b67d110f',
    },
    {
      name: 'libs/libc++_shared.so',
      sha256: 'e8373ee43274541efd2d34fe0588d55bf953612e1417ad47cfd2c4bd1aa383d0',
    },
    {
      name: 'libs/libiesapplogger.so',
      sha256: '08fc4396d0e80aafd83d646ed875289c5987f68a6b3f0827ba1605d2f12130f2',
    },
  ],
  sources: null,
  archive: {
    url: 'https://github.com/J3n5en/EnsoCode/releases/download/v0.2.1/hanbao-0.3.0-darwin-arm64.tar.gz',
    sha256: 'a05a4ebe2fd0b35fc8dd7b76447923e312e2a3105196c9939f6e43379d38dcde',
    bytes: 3_354_443,
    root: 'hanbao-darwin-arm64',
  },
};

export function hanbaoEngineDir(runtimeRoot: string): string {
  return path.join(runtimeRoot, 'hanbao@0.3.0');
}

/** 旧版 SenseVoice 目录名沿用，已下载的用户不必重下 */
export function speechModelDirName(id: SpeechModelId): string {
  return id === 'sense-voice' ? 'sense-voice-int8-2024-07-17' : id;
}

export function speechModelIdFromSettings(state: Record<string, unknown>): SpeechModelId {
  return isSpeechModelId(state.voiceModel) ? state.voiceModel : DEFAULT_SPEECH_MODEL_ID;
}

export interface RecognizerConfig {
  kind: 'offline' | 'online';
  config: Record<string, unknown>;
}

export function recognizerConfig(spec: SpeechModelSpec, dir: string): RecognizerConfig {
  const file = (name: string) => path.join(dir, name);
  const featConfig = { sampleRate: SPEECH_SAMPLE_RATE, featureDim: 80 };
  const common = { provider: 'cpu', debug: 0 };
  switch (spec.id) {
    case 'x-asr-streaming':
      return {
        kind: 'online',
        config: {
          featConfig,
          modelConfig: {
            transducer: {
              encoder: file('encoder.int8.onnx'),
              decoder: file('decoder.onnx'),
              joiner: file('joiner.int8.onnx'),
            },
            tokens: file('tokens.txt'),
            numThreads: 2,
            ...common,
          },
          decodingMethod: 'greedy_search',
          // 长停顿切句，句内短停顿不断
          enableEndpoint: 1,
          rule1MinTrailingSilence: 2.4,
          rule2MinTrailingSilence: 1.0,
          rule3MinUtteranceLength: 30,
        },
      };
    case 'x-asr':
      return {
        kind: 'offline',
        config: {
          featConfig,
          modelConfig: {
            transducer: {
              encoder: file('encoder-epoch-99-avg-1.int8.onnx'),
              decoder: file('decoder-epoch-99-avg-1.onnx'),
              joiner: file('joiner-epoch-99-avg-1.int8.onnx'),
            },
            tokens: file('tokens.txt'),
            numThreads: 2,
            ...common,
          },
          decodingMethod: 'greedy_search',
        },
      };
    case 'qwen3-asr':
      return {
        kind: 'offline',
        config: {
          featConfig,
          modelConfig: {
            qwen3Asr: {
              convFrontend: file('conv_frontend.onnx'),
              encoder: file('encoder.int8.onnx'),
              decoder: file('decoder.int8.onnx'),
              tokenizer: file('tokenizer'),
              hotwords: '',
            },
            tokens: '',
            // 自回归解码慢（RTF≈0.17@4 线程），给足线程
            numThreads: 4,
            ...common,
          },
        },
      };
    case 'sense-voice':
      return {
        kind: 'offline',
        config: {
          featConfig,
          modelConfig: {
            senseVoice: {
              model: file('model.int8.onnx'),
              language: 'auto',
              useInverseTextNormalization: 1,
            },
            tokens: file('tokens.txt'),
            numThreads: 2,
            ...common,
          },
        },
      };
    case 'hanbao':
      throw new Error('hanbao runs its own engine process');
    case 'gemini-live':
    case 'wetype':
      throw new Error('cloud speech model has no local recognizer');
  }
}
