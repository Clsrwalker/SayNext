export type Linear16AudioStats = {
  samples: number;
  rms: number;
  peak: number;
  zeroRatio: number;
  clippedRatio: number;
};

export function computeLinear16AudioStats(chunk: Uint8Array): Linear16AudioStats {
  const sampleCount = Math.floor(chunk.byteLength / 2);
  if (!sampleCount) {
    return {
      samples: 0,
      rms: 0,
      peak: 0,
      zeroRatio: 0,
      clippedRatio: 0,
    };
  }

  const view = new DataView(chunk.buffer, chunk.byteOffset, sampleCount * 2);
  let sumSquares = 0;
  let peak = 0;
  let zeroCount = 0;
  let clippedCount = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true);
    const abs = Math.abs(sample);
    sumSquares += sample * sample;
    if (abs > peak) peak = abs;
    if (sample === 0) zeroCount += 1;
    if (abs >= 32767) clippedCount += 1;
  }

  return {
    samples: sampleCount,
    rms: Math.round(Math.sqrt(sumSquares / sampleCount)),
    peak,
    zeroRatio: Number((zeroCount / sampleCount).toFixed(3)),
    clippedRatio: Number((clippedCount / sampleCount).toFixed(3)),
  };
}
