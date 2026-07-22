from __future__ import annotations

import argparse
import json
import pathlib

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForSequenceClassification, AutoTokenizer


class LogitsWrapper(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids=input_ids, attention_mask=attention_mask).logits


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default="data/models/saynext_memory_router_v1")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_dir = pathlib.Path(args.model_dir).resolve()
    if not model_dir.is_dir():
        raise FileNotFoundError(f"missing memory-router model directory: {model_dir}")
    fp32_path = model_dir / "model.fp32.onnx"
    uint8_path = model_dir / "model.uint8.onnx"
    model = AutoModelForSequenceClassification.from_pretrained(model_dir, local_files_only=True)
    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    model.eval()
    encoded = tokenizer(
        "<SEG_MINUS_2>  <SEG_MINUS_1>  <CURRENT> What is your major?",
        return_tensors="pt",
    )
    wrapper = LogitsWrapper(model)
    torch.onnx.export(
        wrapper,
        (encoded["input_ids"], encoded["attention_mask"]),
        fp32_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    quantize_dynamic(fp32_path, uint8_path, weight_type=QuantType.QUInt8)
    manifest_path = model_dir / "onnx_manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "model": "saynext_memory_router_v1",
                "fp32": fp32_path.name,
                "quantized": uint8_path.name,
                "tokenizer": "tokenizer.json",
                "max_length": 256,
                "truncation_side": "left",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "fp32": str(fp32_path),
        "fp32_bytes": fp32_path.stat().st_size,
        "uint8": str(uint8_path),
        "uint8_bytes": uint8_path.stat().st_size,
    }, indent=2))


if __name__ == "__main__":
    main()
