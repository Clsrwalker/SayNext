import { expect, test } from "bun:test";
import { computeLinear16AudioStats } from "../evenhub-v2/audio-diagnostics";

function pcm16(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    view.setInt16(index * 2, sample, true);
  });
  return bytes;
}

test("computeLinear16AudioStats detects silence", () => {
  const stats = computeLinear16AudioStats(pcm16([0, 0, 0, 0]));

  expect(stats.samples).toBe(4);
  expect(stats.rms).toBe(0);
  expect(stats.peak).toBe(0);
  expect(stats.zeroRatio).toBe(1);
  expect(stats.clippedRatio).toBe(0);
});

test("computeLinear16AudioStats reports signal level and clipping", () => {
  const stats = computeLinear16AudioStats(pcm16([1000, -1000, 32767, -32768]));

  expect(stats.samples).toBe(4);
  expect(stats.rms).toBeGreaterThan(0);
  expect(stats.peak).toBe(32768);
  expect(stats.zeroRatio).toBe(0);
  expect(stats.clippedRatio).toBe(0.5);
});
