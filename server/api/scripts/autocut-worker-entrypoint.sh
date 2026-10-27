#!/bin/sh
set -eu
: "${AUTOCUT_ASR_PYTHON:?CPU Python runtime required}"
: "${AUTOCUT_MODEL_MANIFEST:?Verified model manifest required}"
: "${AUTOCUT_ASR_MODEL:?Local ASR weights required}"
: "${AUTOCUT_ASR_VAD:?Local VAD weights required}"
: "${AUTOCUT_ASR_PUNCTUATION:?Local punctuation weights required}"
"$AUTOCUT_ASR_PYTHON" /app/scripts/autocut-model-manifest.py verify \
  --manifest "$AUTOCUT_MODEL_MANIFEST" --asr "$AUTOCUT_ASR_MODEL" \
  --vad "$AUTOCUT_ASR_VAD" --punctuation "$AUTOCUT_ASR_PUNCTUATION"
exec node /app/dist/autocut-worker.js
