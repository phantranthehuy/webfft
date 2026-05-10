/**
 * Quản lý AudioContext, quyền micro và các nút dùng chung.
 *
 * **iOS / Safari:** `AudioContext` chỉ được phép chạy sau cử chỉ người dùng.
 * Gọi `initAudio()` trực tiếp trong handler `click`/`touchend` (không bọc `setTimeout`),
 * và giữ thứ tự: tạo context → `resume()` ngay → sau đó mới `await getUserMedia`.
 */

/** @type {AudioContext | null} */
let sharedContext = null;

/** @type {MediaStream | null} */
let sharedStream = null;

/** @type {HTMLButtonElement | null} */
let resumeButton = null;

/** @type {(() => void) | null} */
let resumeStateListener = null;

/**
 * @param {number} n
 * @returns {boolean}
 */
function isPowerOfTwoInRange(n) {
  return Number.isInteger(n) && n >= 32 && n <= 32768 && (n & (n - 1)) === 0;
}

function syncResumeButtonVisibility(context) {
  if (!resumeButton) return;
  const suspended = context.state === 'suspended';
  resumeButton.hidden = !suspended;
  resumeButton.setAttribute('aria-hidden', suspended ? 'false' : 'true');
}

/**
 * Nút “Resume” khi context bị suspended (tab nền, policy trình duyệt, v.v.).
 * @param {AudioContext} context
 */
function ensureResumeUi(context) {
  if (resumeButton) {
    syncResumeButtonVisibility(context);
    return;
  }

  resumeButton = document.createElement('button');
  resumeButton.type = 'button';
  resumeButton.id = 'audio-resume';
  resumeButton.className = 'ghost-button audio-resume';
  resumeButton.textContent = 'Resume audio';
  resumeButton.setAttribute('aria-live', 'polite');
  resumeButton.title = 'Khởi động lại audio engine (trình duyệt đã tạm dừng)';

  resumeButton.addEventListener('click', async () => {
    try {
      await context.resume();
    } catch {
      /* ignore */
    }
    syncResumeButtonVisibility(context);
  });

  const header = document.querySelector('.app-header');
  if (header) {
    header.appendChild(resumeButton);
  } else {
    document.body.appendChild(resumeButton);
  }

  resumeStateListener = () => syncResumeButtonVisibility(context);
  context.addEventListener('statechange', resumeStateListener);

  syncResumeButtonVisibility(context);
}

/**
 * Dừng track micro đang giữ.
 */
function stopSharedStream() {
  if (!sharedStream) return;
  for (const track of sharedStream.getTracks()) {
    track.stop();
  }
  sharedStream = null;
}

/**
 * Khởi tạo (hoặc tái dùng) AudioContext và mở luồng micro.
 * Nên gọi từ handler người dùng (đặc biệt trên iOS).
 *
 * @returns {Promise<{ context: AudioContext, stream: MediaStream }>}
 */
export async function initAudio() {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }

  ensureResumeUi(sharedContext);

  /* Giữ user gesture: resume trước mọi await dài. */
  void sharedContext.resume();

  stopSharedStream();

  sharedStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  await sharedContext.resume();
  syncResumeButtonVisibility(sharedContext);

  return { context: sharedContext, stream: sharedStream };
}

/**
 * Tạo AnalyserNode gắn với context đã `initAudio()`.
 *
 * @param {number} [fftSize=2048] — lũy thừa của 2 trong [32, 32768]
 * @returns {AnalyserNode}
 */
export function createAnalyser(fftSize = 2048) {
  if (!sharedContext) {
    throw new Error('createAnalyser: gọi initAudio() trước');
  }
  if (!isPowerOfTwoInRange(fftSize)) {
    throw new RangeError(
      'createAnalyser: fftSize phải là lũy thừa của 2 từ 32 đến 32768',
    );
  }

  const analyser = sharedContext.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.35;
  return analyser;
}

/**
 * Dựng các nút dùng chung cho chuỗi micro → xử lý → loa (các tab sau nối thêm).
 *
 * @param {AudioContext} context
 * @param {MediaStream} stream
 * @returns {{
 *   context: AudioContext,
 *   stream: MediaStream,
 *   input: MediaStreamAudioSourceNode,
 *   masterGain: GainNode,
 *   connectThroughGain: (destination: AudioNode) => void,
 *   disconnectAll: () => void,
 * }}
 */
export function createAudioGraph(context, stream) {
  const input = context.createMediaStreamSource(stream);
  const masterGain = context.createGain();
  masterGain.gain.value = 1;

  return {
    context,
    stream,
    input,
    masterGain,
    connectThroughGain(destination) {
      input.disconnect();
      masterGain.disconnect();
      input.connect(masterGain);
      masterGain.connect(destination);
    },
    disconnectAll() {
      try {
        input.disconnect();
      } catch {
        /* ignore */
      }
      try {
        masterGain.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
