"""CPU-only FunASR bridge. Model directories must be provisioned and licensed separately."""
import argparse
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["MODELSCOPE_OFFLINE"] = "1"
for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[name] = "2"
parser = argparse.ArgumentParser()
for name in ("model", "vad", "punctuation"):
    parser.add_argument("--" + name, required=True)
parser.add_argument("--input")
parser.add_argument("--daemon", action="store_true")
args = parser.parse_args()
if not args.daemon and not args.input:
    parser.error("--input is required without --daemon")
started = time.perf_counter()
from funasr import AutoModel

model = AutoModel(model=args.model, vad_model=args.vad, punc_model=args.punctuation,
                  device="cpu", ncpu=2, disable_update=True, trust_remote_code=False)
load_ms = round((time.perf_counter() - started) * 1000)

def transcribe(path):
    result = model.generate(input=path, sentence_timestamp=True, batch_size_s=0)
    # FunASR 1.3.22 emits this explicit shape when VAD detects no speech.
    # Missing results or recognized text without timestamps remain failures.
    if (isinstance(result, list) and len(result) == 1
            and isinstance(result[0], dict)
            and result[0].get("text") == ""
            and result[0].get("timestamp") == []
            and not result[0].get("sentence_info")):
        return {"segments": []}
    if not result or "sentence_info" not in result[0]:
        raise RuntimeError("ASR must return measured sentence timestamps; interpolation is forbidden")
    segments = [{"start": int(s["start"]), "end": int(s["end"]),
                 "text": s["text"].strip(), "confidence": None}
                for s in result[0]["sentence_info"] if s.get("text", "").strip()]
    return {"segments": segments}

if args.daemon:
    print("AUTOCUT_ASR_READY=" + json.dumps({"pid": os.getpid(), "loadMs": load_ms}), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            started = time.perf_counter()
            transcript = transcribe(request["path"])
            print("AUTOCUT_TRANSCRIPT=" + json.dumps({"id": request["id"], "transcript": transcript,
                  "recognitionMs": round((time.perf_counter() - started) * 1000)}, ensure_ascii=False), flush=True)
        except Exception:
            print('AUTOCUT_ASR_ERROR={"error":"recognition_failed"}', flush=True)
            raise
else:
    print("AUTOCUT_TRANSCRIPT=" + json.dumps(transcribe(args.input), ensure_ascii=False), flush=True)
