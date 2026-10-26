// Approved only for this managed route. Other models keep their existing clock.
export const DEEPSEEK_AGENT_MODEL = "pinhaozhan.text.deepseek-v4.1-flash";
export const DEEPSEEK_PREFLIGHT_MS = 60000;

export function modelTiming(modelId: string, modelMs: number) {
  const deepseek = modelId === DEEPSEEK_AGENT_MODEL;
  const inferenceMs = deepseek
    ? Math.min(DEEPSEEK_PREFLIGHT_MS, modelMs)
    : modelMs;
  const preflightMs = deepseek ? inferenceMs : 0;
  return {
    version: 1,
    preflightMs,
    inferenceMs,
    maxRoundMs: preflightMs + inferenceMs,
  };
}

/** Reset once at the trusted pre-submit boundary, never on response chunks or retries. */
export function modelClock(
  controller: AbortController,
  timing: ReturnType<typeof modelTiming>,
  activeDeadline: number,
) {
  const roundDeadline = Date.now() + timing.maxRoundMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let phaseDeadline = 0;
  let inferenceStarted = false;
  const arm = (duration: number) => {
    clearTimeout(timer);
    phaseDeadline = Math.min(
      activeDeadline,
      roundDeadline,
      Date.now() + duration,
    );
    const remaining = phaseDeadline - Date.now();
    if (remaining <= 0) controller.abort();
    else timer = setTimeout(() => controller.abort(), remaining);
  };
  arm(timing.preflightMs || timing.inferenceMs);
  return {
    beginInference() {
      if (Date.now() >= phaseDeadline) controller.abort();
      controller.signal.throwIfAborted();
      if (inferenceStarted || !timing.preflightMs) return;
      inferenceStarted = true;
      arm(timing.inferenceMs);
      controller.signal.throwIfAborted();
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
