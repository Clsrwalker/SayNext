from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import time

import numpy as np
import onnxruntime as ort
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from tokenizers import Tokenizer


LANES = ["none", "profile", "company_fit", "named_project", "personal_experience", "behavioral"]
LABEL_TO_ID = {lane: index for index, lane in enumerate(LANES)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="data/models/saynext_memory_router_v1/model.uint8.onnx")
    parser.add_argument("--tokenizer", default="data/models/saynext_memory_router_v1/tokenizer.json")
    parser.add_argument("--eval", default="data/review/memory-router-teacher-eval-v1.jsonl")
    parser.add_argument("--output", default="data/review/memory-router-onnx-eval-v1.json")
    return parser.parse_args()


def read_json_lines(path: pathlib.Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * quantile)))
    return ordered[index]


def main() -> None:
    args = parse_args()
    model_path = pathlib.Path(args.model).resolve()
    tokenizer_path = pathlib.Path(args.tokenizer).resolve()
    eval_path = pathlib.Path(args.eval).resolve()
    output_path = pathlib.Path(args.output).resolve()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    startup_started = time.perf_counter()
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    tokenizer.enable_truncation(max_length=256, direction="left")
    startup_ms = (time.perf_counter() - startup_started) * 1000
    output_name = session.get_outputs()[0].name
    expected_ids: list[int] = []
    predicted_ids: list[int] = []
    latencies: list[float] = []
    cases = []

    for row in read_json_lines(eval_path):
        expected = str(row["expectedLane"])
        if expected not in LABEL_TO_ID:
            raise RuntimeError(f"invalid expectedLane for {row.get('id')}: {expected}")
        serialized = (
            f"<SEG_MINUS_2> {row.get('segmentMinus2', '')} "
            f"<SEG_MINUS_1> {row.get('segmentMinus1', '')} "
            f"<CURRENT> {row.get('current', '')}"
        )
        encoded = tokenizer.encode(serialized)
        started = time.perf_counter()
        logits = session.run(
            [output_name],
            {
                "input_ids": np.asarray([encoded.ids], dtype=np.int64),
                "attention_mask": np.asarray([encoded.attention_mask], dtype=np.int64),
            },
        )[0][0]
        latency_ms = (time.perf_counter() - started) * 1000
        probabilities = np.exp(logits - np.max(logits))
        probabilities = probabilities / np.sum(probabilities)
        predicted_id = int(np.argmax(probabilities))
        expected_id = LABEL_TO_ID[expected]
        expected_ids.append(expected_id)
        predicted_ids.append(predicted_id)
        latencies.append(latency_ms)
        cases.append({
            "id": row.get("id"),
            "expectedLane": expected,
            "predictedLane": LANES[predicted_id],
            "confidence": float(probabilities[predicted_id]),
            "latencyMs": round(latency_ms, 3),
        })

    expected_gate = [int(value != 0) for value in expected_ids]
    predicted_gate = [int(value != 0) for value in predicted_ids]
    report = {
        "model": str(model_path),
        "eval": str(eval_path),
        "cases": len(cases),
        "laneAccuracy": float(np.mean(np.asarray(expected_ids) == np.asarray(predicted_ids))),
        "laneMacroF1": float(f1_score(expected_ids, predicted_ids, average="macro", zero_division=0)),
        "memoryGateAccuracy": float(np.mean(np.asarray(expected_gate) == np.asarray(predicted_gate))),
        "memoryGateF1": float(f1_score(expected_gate, predicted_gate, zero_division=0)),
        "classificationReport": classification_report(
            expected_ids,
            predicted_ids,
            labels=list(range(len(LANES))),
            target_names=LANES,
            output_dict=True,
            zero_division=0,
        ),
        "confusionMatrix": confusion_matrix(
            expected_ids, predicted_ids, labels=list(range(len(LANES)))
        ).tolist(),
        "latencyMs": {
            "startup": round(startup_ms, 3),
            "mean": round(statistics.mean(latencies), 3),
            "p50": round(percentile(latencies, 0.50), 3),
            "p95": round(percentile(latencies, 0.95), 3),
            "max": round(max(latencies, default=0.0), 3),
        },
        "predictions": cases,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "cases", "laneAccuracy", "laneMacroF1", "memoryGateAccuracy", "memoryGateF1", "latencyMs"
    )}, indent=2))


if __name__ == "__main__":
    main()
