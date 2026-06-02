export type PhoneMicHandle = {
  stop(): Promise<void>;
};

type AudioContextLike = AudioContext & {
  createScriptProcessor(bufferSize?: number, numberOfInputChannels?: number, numberOfOutputChannels?: number): ScriptProcessorNode;
};

const TARGET_SAMPLE_RATE = 16000;

function describeCurrentOrigin(): string {
  if (typeof window === "undefined") return "unknown origin";
  return window.location.origin || window.location.href || "unknown origin";
}

function micOpenError(error: unknown): Error {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return new Error("Phone microphone permission was denied. Enable microphone permission for Even Realities, then restart this SayNext session.");
  }

  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return new Error("No phone microphone was found by this WebView.");
  }

  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return new Error("Phone microphone is busy or unavailable. Close other recording apps, then tap Pause and Start again.");
  }

  return new Error(`Phone microphone failed: ${error.name}${error.message ? ` - ${error.message}` : ""}`);
}

function resampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return new Float32Array(input);
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const weight = sourceIndex - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }

  return output;
}

function floatToLinear16(samples: Float32Array): Uint8Array {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return output;
}

export async function startPhoneMic(params: {
  onPcm: (pcm: Uint8Array) => void;
  onStatus?: (message: string) => void;
}): Promise<PhoneMicHandle> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error(`Phone microphone requires a secure WebView. Current origin is ${describeCurrentOrigin()}; install the packaged EvenHub app or use HTTPS instead of HTTP QR dev.`);
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(`Phone microphone is not available in this WebView. Current origin is ${describeCurrentOrigin()}; install the packaged EvenHub app or use HTTPS.`);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (error) {
    throw micOpenError(error);
  }

  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Web Audio is not available in this WebView.");
  }

  const audioContext = new AudioContextCtor() as AudioContextLike;
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const mute = audioContext.createGain();
  mute.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const resampled = resampleTo16k(input, audioContext.sampleRate);
    params.onPcm(floatToLinear16(resampled));
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);
  params.onStatus?.(`Phone mic listening at ${audioContext.sampleRate}Hz -> 16k PCM.`);

  return {
    async stop() {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close().catch(() => undefined);
      params.onStatus?.("Phone mic stopped.");
    },
  };
}
