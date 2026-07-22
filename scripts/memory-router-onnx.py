from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


LANES = ["none", "profile", "company_fit", "named_project", "personal_experience", "behavioral"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--tokenizer", required=True)
    return parser.parse_args()


def probabilities_from_logits(logits: np.ndarray) -> np.ndarray:
    values = np.asarray(logits, dtype=np.float64)
    values = np.exp(values - np.max(values))
    return values / np.sum(values)


def main() -> None:
    args = parse_args()
    model_path = Path(args.model)
    tokenizer_path = Path(args.tokenizer)
    if not model_path.is_file() or not tokenizer_path.is_file():
        raise FileNotFoundError("memory-router artifact is incomplete")
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
    output_name = session.get_outputs()[0].name
    print(json.dumps({"type": "ready", "model": "saynext_memory_router_v1_onnx"}), flush=True)

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
                [output_name],
                {
                    "input_ids": np.asarray([encoded.ids], dtype=np.int64),
                    "attention_mask": np.asarray([encoded.attention_mask], dtype=np.int64),
                },
            )[0][0]
            probabilities = probabilities_from_logits(logits)
            index = int(np.argmax(probabilities))
            print(json.dumps({
                "id": request_id,
                "lane": LANES[index],
                "confidence": float(probabilities[index]),
                "probabilities": {lane: float(probabilities[lane_index]) for lane_index, lane in enumerate(LANES)},
                "model": "saynext_memory_router_v1_onnx",
            }), flush=True)
        except Exception as error:
            print(json.dumps({"id": request_id, "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
