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

// ---- M3 新增：射擊體發射／蓄力、控制台確認音 ----

/** 射擊體蓄力（windup）：短暫上滑的高頻電子音，帶「充能中」的預警感（telegraph 音效版）。 */
export function playSpitterWindup(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "sawtooth",
      freqStart: 300,
      freqEnd: 1100,
      duration: 0.38,
      env: { attack: 0.02, decay: 0.35, peak: 0.32 },
      filterFreq: 2200,
    });
  });
}

/** 射擊體發射：噴射感 noise burst 加中頻方波，與脈衝手槍／散射槍音色明顯區隔（更悶更濕潤）。 */
export function playSpitterFire(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.14,
      filterType: "bandpass",
      freqStart: 1100,
      freqEnd: 350,
      env: { attack: 0.004, decay: 0.13, peak: 0.55 },
    });
    playOscVoice(ctx, master, {
      type: "square",
      freqStart: 700,
      freqEnd: 180,
      duration: 0.16,
      env: { attack: 0.002, decay: 0.15, peak: 0.4 },
    });
  });
}

/** 控制台啟動確認音：清亮上升琶音感（雙音），帶「機關解鎖」的正回饋。 */
export function playConsoleActivate(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "triangle",
      freqStart: 440,
      freqEnd: 880,
      duration: 0.18,
      env: { attack: 0.004, decay: 0.16, peak: 0.45 },
    });
    playOscVoice(ctx, master, {
      type: "sine",
      freqStart: 660,
      freqEnd: 1320,
      duration: 0.22,
      env: { attack: 0.06, decay: 0.18, peak: 0.35 },
    });
  });
}

// ---- M3 第二階段新增：電漿步槍發射、守衛體衝撞蓄力／撞擊 ----

/** 電漿步槍發射：明亮短促的能量音（三角波高頻下滑加窄頻帶 noise），與脈衝手槍／散射槍／
 *  射擊體發射聲皆可辨（更亮、更「電」，呼應能源青科技定位）。 */
export function playPlasmaFire(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "triangle",
      freqStart: 1800,
      freqEnd: 500,
      duration: 0.05,
      env: { attack: 0.0008, decay: 0.045, peak: 0.4 },
    });
    playNoiseVoice(ctx, master, {
      duration: 0.04,
      filterType: "highpass",
      freqStart: 4000,
      env: { attack: 0.0005, decay: 0.035, peak: 0.25 },
    });
  });
}

/** 守衛體衝撞蓄力（telegraph）：低沉緩慢上滑的鋸齒波低吼，帶「蓄力／威嚇」感，
 *  與射擊體蓄力聲（高頻電子音）明顯區隔（更低沉、更具重量感）。 */
export function playWardenChargeWindup(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "sawtooth",
      freqStart: 90,
      freqEnd: 220,
      duration: 0.46,
      env: { attack: 0.03, decay: 0.42, peak: 0.5 },
      filterFreq: 900,
    });
    playNoiseVoice(ctx, master, {
      duration: 0.46,
      filterType: "lowpass",
      freqStart: 500,
      freqEnd: 200,
      env: { attack: 0.05, decay: 0.4, peak: 0.25 },
    });
  });
}

/** 守衛體衝撞撞擊：厚重低頻撞擊聲（noise 加低頻方波），命中玩家瞬間播放。 */
export function playWardenChargeImpact(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.18,
      filterType: "lowpass",
      freqStart: 900,
      freqEnd: 150,
      env: { attack: 0.001, decay: 0.16, peak: 0.65 },
    });
    playOscVoice(ctx, master, {
      type: "square",
      freqStart: 140,
      freqEnd: 45,
      duration: 0.2,
      env: { attack: 0.001, decay: 0.18, peak: 0.5 },
    });
  });
}

// ---- M3 第三階段新增：能量砲充能／發射、首領彈幕／召喚／震波 telegraph 與引爆、
// 首領受擊與死亡 ----

/** 能量砲充能起始：上升音調（本次派工規格），持續整個充能期間營造「蓄勢待發」的張力，
 *  單次觸發即可（不需逐幀重播，長 duration 涵蓋 CANNON_CHARGE_DURATION 全程）。 */
export function playCannonChargeStart(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "sawtooth",
      freqStart: 140,
      freqEnd: 900,
      duration: 1.2,
      env: { attack: 0.05, decay: 1.1, peak: 0.4 },
      filterFreq: 2400,
    });
  });
}

/** 能量砲發射：重低音加寬頻 noise burst，遠比其餘武器沉重（本次派工規格：「重低音」）。 */
export function playCannonFire(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.22,
      filterType: "lowpass",
      freqStart: 2200,
      freqEnd: 300,
      env: { attack: 0.002, decay: 0.2, peak: 0.75 },
    });
    playOscVoice(ctx, master, {
      type: "square",
      freqStart: 220,
      freqEnd: 40,
      duration: 0.32,
      env: { attack: 0.002, decay: 0.3, peak: 0.6 },
    });
  });
}

/** 首領彈幕單發發射聲：短促電子脈衝，與射擊體發射聲區隔（更尖銳、更具機械節奏感）。 */
export function playBossBarrageFire(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "square",
      freqStart: 950,
      freqEnd: 260,
      duration: 0.06,
      env: { attack: 0.001, decay: 0.055, peak: 0.32 },
    });
  });
}

/** 首領召喚：低頻上升掃頻加噪音，帶「喚醒」感。 */
export function playBossSummon(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "sawtooth",
      freqStart: 80,
      freqEnd: 260,
      duration: 0.5,
      env: { attack: 0.02, decay: 0.46, peak: 0.45 },
      filterFreq: 1200,
    });
    playNoiseVoice(ctx, master, {
      duration: 0.45,
      filterType: "bandpass",
      freqStart: 600,
      freqEnd: 1400,
      env: { attack: 0.02, decay: 0.4, peak: 0.3 },
    });
  });
}

/** 首領全場脈衝震波 telegraph：低鳴，涵蓋 SHOCKWAVE_TELEGRAPH_DURATION（1.2 秒）全程，
 *  單次觸發即可（同能量砲充能音慣例）。 */
export function playBossShockwaveTelegraph(): void {
  safePlay((ctx, master) => {
    playOscVoice(ctx, master, {
      type: "sine",
      freqStart: 45,
      freqEnd: 65,
      duration: 1.2,
      env: { attack: 0.1, decay: 1.05, peak: 0.55 },
      filterFreq: 300,
    });
  });
}

/** 首領全場脈衝震波引爆：厚重寬頻爆裂聲，明顯比守衛體衝撞撞擊更巨大（首領規格）。 */
export function playBossShockwaveDetonate(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.35,
      filterType: "lowpass",
      freqStart: 3000,
      freqEnd: 120,
      env: { attack: 0.001, decay: 0.32, peak: 0.85 },
    });
    playOscVoice(ctx, master, {
      type: "square",
      freqStart: 180,
      freqEnd: 30,
      duration: 0.4,
      env: { attack: 0.001, decay: 0.38, peak: 0.65 },
    });
  });
}

/** 首領受擊：厚重金屬撞擊感，與一般敵人命中聲（playHit）區隔。 */
export function playBossHit(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 0.08,
      filterType: "bandpass",
      freqStart: 1800,
      freqEnd: 700,
      env: { attack: 0.001, decay: 0.07, peak: 0.5 },
    });
    playOscVoice(ctx, master, {
      type: "triangle",
      freqStart: 300,
      freqEnd: 150,
      duration: 0.1,
      env: { attack: 0.001, decay: 0.09, peak: 0.35 },
    });
  });
}

/** 首領死亡：巨大爆炸感（寬頻 noise 長衰減加低頻鋸齒下滑），遠比一般敵人死亡聲（playEnemyDie）
 *  更長更沉重，呼應「核心過載」的真結局視覺。 */
export function playBossDeath(): void {
  safePlay((ctx, master) => {
    playNoiseVoice(ctx, master, {
      duration: 1.1,
      filterType: "lowpass",
      freqStart: 4000,
      freqEnd: 80,
      env: { attack: 0.005, decay: 1.0, peak: 0.9 },
    });
    playOscVoice(ctx, master, {
      type: "sawtooth",
      freqStart: 220,
      freqEnd: 20,
      duration: 1.3,
      env: { attack: 0.005, decay: 1.2, peak: 0.55 },
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
