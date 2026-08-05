// 極小合成引擎：全部音效以 Web Audio 節點圖即時合成（PLAN §6.5），repo 零音訊檔。
// AudioContext 延遲建立：首次呼叫 resumeAudioOnGesture()（現有「點擊進入」手勢）才建立並 resume。
// voice 圖：oscillator／noise buffer → gain envelope（attack 線性、decay 指數）→ biquad filter
// → master gain（由 setMasterVolume() 套用設定系統的主音量，見 core/settings.ts）。
// 無音效裝置或 AudioContext 失敗時一律靜音續玩，禁止把例外拋出給呼叫端（PLAN §6.7）。

const DEFAULT_MASTER_GAIN = 0.8; // 對應設定系統音量預設值 80／100（core/settings.ts VOLUME_DEFAULT）

let audioContext: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let unavailable = false; // 一旦初始化失敗就記住，避免每次播放都重複嘗試並洗版警告
// 目前套用的主音量比例（0～1）。setMasterVolume() 可在 AudioContext 建立前後皆呼叫：
// 建立前只記錄比例，ensureContext() 建立 gain node 時會讀取套用；建立後則立即生效。
let masterVolumeRatio = DEFAULT_MASTER_GAIN;

interface AudioContextConstructorWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

function ensureContext(): AudioContext | null {
  if (unavailable) return null;
  if (audioContext) return audioContext;

  try {
    const w = window as unknown as AudioContextConstructorWindow;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      unavailable = true;
      console.warn("[audio] 瀏覽器不支援 AudioContext，音效停用（靜音續玩）。");
      return null;
    }
    audioContext = new Ctor();
    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = masterVolumeRatio;
    masterGainNode.connect(audioContext.destination);
    return audioContext;
  } catch (err) {
    unavailable = true;
    console.warn("[audio] AudioContext 建立失敗，音效停用（靜音續玩）：", err);
    return null;
  }
}

/**
 * 套用設定系統的主音量（正式 API，見 core/settings.ts SettingsStore.setVolume）。
 * volume0to100 會被 clamp 到 0～100 再換算成 0～1 比例；呼叫端不應直接改 masterGainNode。
 */
export function setMasterVolume(volume0to100: number): void {
  const clamped = Math.max(0, Math.min(100, volume0to100));
  masterVolumeRatio = clamped / 100;
  if (masterGainNode) masterGainNode.gain.value = masterVolumeRatio;
}

/**
 * 供 audio/music.ts 共用同一顆 AudioContext 與 master gain（M2 第三階段新增）：
 * 音樂與 SFX 必須經過同一個 masterGainNode 才會一起受設定系統的主音量控制，
 * 不應各自建立獨立 AudioContext（那會讓兩者的 currentTime 基準不同步，且無法共同靜音）。
 * 回傳 null 代表本機瀏覽器不支援或建立失敗（呼叫端一律靜音續玩，不拋例外）。
 */
export function getSharedAudioContext(): AudioContext | null {
  return ensureContext();
}

/** 供 music.ts 把音樂匯流排接到與 SFX 相同的 master gain（尚未建立 context 時回傳 null）。 */
export function getSharedMasterGain(): GainNode | null {
  return masterGainNode;
}

/** 供 music.ts 重用同一份白噪音 buffer（金屬敲擊／打擊層等 noise-based 音色），避免重複配置。 */
export function getSharedNoiseBuffer(ctx: AudioContext): AudioBuffer {
  return getNoiseBuffer(ctx);
}

/** 首次使用者手勢時呼叫（現有「點擊進入」畫面即手勢入口），嘗試建立並 resume AudioContext。 */
export function resumeAudioOnGesture(): void {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch((err: unknown) => {
      console.warn("[audio] AudioContext resume 失敗（非致命，靜音續玩）：", err);
    });
  }
}

/** 建立（或沿用快取的）1 秒白噪音 buffer，供各 noise-based SFX 截取／循環使用。 */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // 音效噪音只影響外觀／聽覺呈現，不涉及 PLAN §6.4 決定性鐵則；用簡單 LCG 只是圖個
  // 乾淨可重現的產生方式，不需要走 rng/rng.ts 的 stream() 命名空間。
  let seed = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

interface EnvelopeSpec {
  attack: number; // 秒
  decay: number; // 秒
  peak: number; // 0..1
}

function applyEnvelope(param: AudioParam, now: number, env: EnvelopeSpec): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(0.0001, now);
  param.linearRampToValueAtTime(Math.max(env.peak, 0.0002), now + env.attack);
  param.exponentialRampToValueAtTime(0.0001, now + env.attack + env.decay);
}

function safePlay(build: (ctx: AudioContext, master: GainNode) => void): void {
  try {
    const ctx = ensureContext();
    if (!ctx || !masterGainNode) return;
    build(ctx, masterGainNode);
  } catch (err) {
    console.warn("[audio] 播放音效時發生例外（非致命，靜音續玩）：", err);
  }
}

interface NoiseVoiceOpts {
  duration: number;
  filterType: BiquadFilterType;
  freqStart: number;
  freqEnd?: number;
  env: EnvelopeSpec;
}

function playNoiseVoice(ctx: AudioContext, master: GainNode, opts: NoiseVoiceOpts): void {
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.setValueAtTime(opts.freqStart, now);
  if (opts.freqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), now + opts.duration);
  }

  const gain = ctx.createGain();
  applyEnvelope(gain.gain, now, opts.env);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  src.start(now);
  src.stop(now + opts.duration + 0.05);
}

interface OscVoiceOpts {
  type: OscillatorType;
  freqStart: number;
  freqEnd: number;
  duration: number;
  env: EnvelopeSpec;
  filterFreq?: number;
}

function playOscVoice(ctx: AudioContext, master: GainNode, opts: OscVoiceOpts): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 1), now + opts.duration);

  const gain = ctx.createGain();
  applyEnvelope(gain.gain, now, opts.env);

  let tail: AudioNode = osc;
  if (opts.filterFreq !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = opts.filterFreq;
    osc.connect(filter);
    tail = filter;
  }
  tail.connect(gain);
  gain.connect(master);

  osc.start(now);
  osc.stop(now + opts.duration + 0.05);
}

/** 槍聲（脈衝手槍）：noise burst 加方波 pitch 下滑，短促清脆。 */
export function playShoot(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.06,
      filterType: "bandpass",
      freqStart: 2200,
      freqEnd: 900,
      env: { attack: 0.001, decay: 0.05, peak: 0.5 },
    });
    playOscVoice(ctx, master, {
      type: "square",
      freqStart: 520,
      freqEnd: 120,
      duration: 0.08,
      env: { attack: 0.001, decay: 0.07, peak: 0.35 },
    });
  });
}

/** 命中聲（非致命）：短 click 加中頻。 */
export function playHit(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.03,
      filterType: "highpass",
      freqStart: 3000,
      env: { attack: 0.0005, decay: 0.03, peak: 0.4 },
    });
    playOscVoice(ctx, master, {
      type: "triangle",
      freqStart: 900,
      freqEnd: 700,
      duration: 0.05,
      env: { attack: 0.001, decay: 0.05, peak: 0.3 },
    });
  });
}

/** 敵人死亡：低頻碎裂感（noise 下滑加鋸齒波下滑）。 */
export function playEnemyDie(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.25,
      filterType: "lowpass",
      freqStart: 1400,
      freqEnd: 200,
      env: { attack: 0.002, decay: 0.22, peak: 0.55 },
    });
    playOscVoice(ctx, master, {
      type: "sawtooth",
      freqStart: 180,
      freqEnd: 40,
      duration: 0.3,
      env: { attack: 0.002, decay: 0.28, peak: 0.4 },
    });
  });
}

/** 玩家受傷：低沉悶響。 */
export function playPlayerHurt(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "sine",
      freqStart: 160,
      freqEnd: 60,
      duration: 0.2,
      env: { attack: 0.001, decay: 0.18, peak: 0.6 },
      filterFreq: 500,
    });
    playNoiseVoice(ctx, master, {
      duration: 0.12,
      filterType: "lowpass",
      freqStart: 400,
      env: { attack: 0.001, decay: 0.1, peak: 0.3 },
    });
  });
}

/** 重生：上滑合成器音，帶回歸感。 */
export function playRespawn(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "sine",
      freqStart: 220,
      freqEnd: 660,
      duration: 0.3,
      env: { attack: 0.02, decay: 0.28, peak: 0.5 },
    });
  });
}

// ---- M2 新增：散射槍、武器切換、撿取、門機械聲 ----

/** 散射槍槍聲：比脈衝手槍更寬的 noise burst（多珠齊發的量感）加低頻方波悶響，短促但更粗獷。 */
export function playShotgunFire(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.09,
      filterType: "bandpass",
      freqStart: 1400,
      freqEnd: 500,
      env: { attack: 0.001, decay: 0.08, peak: 0.7 },
    });
    playOscVoice(ctx, master, {
      type: "square",
      freqStart: 220,
      freqEnd: 70,
      duration: 0.12,
      env: { attack: 0.001, decay: 0.1, peak: 0.45 },
    });
  });
}

/** 武器切換：短促機械 click（無音高變化的高頻 noise burst）。 */
export function playSwitch(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.04,
      filterType: "highpass",
      freqStart: 2500,
      env: { attack: 0.0005, decay: 0.035, peak: 0.35 },
    });
  });
}

/** 撿取：清脆上滑短音，帶「獲得」的正回饋感。 */
export function playPickup(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "triangle",
      freqStart: 500,
      freqEnd: 1100,
      duration: 0.12,
      env: { attack: 0.005, decay: 0.11, peak: 0.4 },
    });
  });
}

/** 門機械滑動聲：低頻 noise 加緩慢下滑合成器音，機械感。 */
export function playDoorMove(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.5,
      filterType: "lowpass",
      freqStart: 700,
      freqEnd: 250,
      env: { attack: 0.02, decay: 0.45, peak: 0.35 },
    });
    playOscVoice(ctx, master, {
      type: "sawtooth",
      freqStart: 140,
      freqEnd: 90,
      duration: 0.4,
      env: { attack: 0.02, decay: 0.35, peak: 0.2 },
    });
  });
}
