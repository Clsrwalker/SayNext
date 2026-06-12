export const TRANSCRIPT_FOLLOW_THRESHOLD_PX = 72;

export function shouldAutoFollowTranscriptScroll(params: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  thresholdPx?: number;
}): boolean {
  const threshold = params.thresholdPx ?? TRANSCRIPT_FOLLOW_THRESHOLD_PX;
  return params.scrollHeight - params.scrollTop - params.clientHeight <= threshold;
}
