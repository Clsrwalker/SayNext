from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--tokenizer", required=True)
    parser.add_argument("--threshold", required=True, type=float)
    return parser.parse_args()


def probability_from_logits(logits: np.ndarray) -> float:
    values = np.asarray(logits, dtype=np.float64)
    values = np.exp(values - np.max(values))
    return float(values[1] / np.sum(values))


def main() -> None:
    args = parse_args()
    model_path = Path(args.model)
    tokenizer_path = Path(args.tokenizer)
    if not model_path.is_file() or not tokenizer_path.is_file():
        raise FileNotFoundError("router artifact is incomplete")

    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    tokenizer.enable_truncation(max_length=256, direction="left")
    print(json.dumps({"type": "ready", "model": "saynext_context_router_v2"}), flush=True)

    for raw_line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(raw_line)
            request_id = str(request.get("id", ""))
            serialized = (
                f"<SEG_MINUS_2> {request.get('segmentMinus2', '')} "
                f"<SEG_MINUS_1> {request.get('segmentMinus1', '')} "
                f"<CURRENT> {request.get('current', '')}"
            )
            encoded = tokenizer.encode(serialized)
            logits = session.run(
                ["logits"],
                {
                    "input_ids": np.asarray([encoded.ids], dtype=np.int64),
                    "attention_mask": np.asarray([encoded.attention_mask], dtype=np.int64),
                },
            )[0][0]
            probability = probability_from_logits(logits)
            print(json.dumps({
                "id": request_id,
                "probability": probability,
                "decision": "cue_needed" if probability >= args.threshold else "no_cue",
                "threshold": args.threshold,
                "model": "saynext_context_router_v2_onnx",
            }), flush=True)
        except Exception as error:
            print(json.dumps({"id": request_id, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
