from __future__ import annotations

import argparse
import collections
import copy
import hashlib
import json
import math
import os
import pathlib
import random
import time
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as functional
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup


LANES = ["none", "profile", "company_fit", "named_project", "personal_experience", "behavioral"]
LABEL_TO_ID = {label: index for index, label in enumerate(LANES)}
ID_TO_LABEL = {index: label for label, index in LABEL_TO_ID.items()}
SPECIAL_TOKENS = ["<SEG_MINUS_2>", "<SEG_MINUS_1>", "<CURRENT>"]
SEED = 20260721
MAX_LENGTH = 256
BATCH_SIZE = 8
GRADIENT_ACCUMULATION = 2
HEAD_EPOCHS = 1
TOP_EPOCHS = 3


@dataclass
class Row:
    id: str
    segment_minus_2: str
    segment_minus_1: str
    current: str
    label: int
    group: str
    origin: str
    confidence: float
    label_source: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="annotation_batches/memory_router_labels_v1.jsonl")
    parser.add_argument("--human-labels", default="annotation_batches/memory_router_human_labels_v1.jsonl")
    parser.add_argument("--candidates", default="data/review/saynext-memory-router-v1-candidates.jsonl")
    parser.add_argument("--output", default="data/models/saynext_memory_router_v1")
    parser.add_argument(
        "--base-model",
        default=os.environ.get(
            "MEMORY_ROUTER_BASE_MODEL",
            r"E:\csci 5501 deeplearning project saynext\model\saynext_context_router_v2",
        ),
    )
    parser.add_argument("--minimum-confidence", type=float, default=0.60)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)


def read_json_lines(path: pathlib.Path) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def load_rows(
    label_path: pathlib.Path,
    candidate_path: pathlib.Path,
    human_label_path: pathlib.Path,
    minimum_confidence: float,
) -> tuple[list[Row], dict[str, int]]:
    candidates = {str(raw["id"]): raw for raw in read_json_lines(candidate_path)}
    teacher_labels = read_json_lines(label_path)
    human_labels = read_json_lines(human_label_path) if human_label_path.is_file() else []
    labels_by_id: dict[str, dict[str, object]] = {}
    for source_name, source_rows in (("teacher", teacher_labels), ("human", human_labels)):
        seen_source_ids: set[str] = set()
        for raw in source_rows:
            row_id = str(raw["id"])
            if row_id in seen_source_ids:
                raise RuntimeError(f"duplicate {source_name} memory-router label: {row_id}")
            if source_name == "human" and row_id not in candidates:
                raise RuntimeError(f"human memory-router label references missing candidate: {row_id}")
            if source_name == "human" and str(raw.get("memoryLane", "")) not in LABEL_TO_ID:
                raise RuntimeError(f"human memory-router label has invalid lane: {row_id}")
            seen_source_ids.add(row_id)
            labels_by_id[row_id] = {**raw, "resolvedLabelSource": source_name}

    rows: list[Row] = []
    teacher_positive_excluded = 0
    low_confidence_excluded = 0
    for row_id, raw in labels_by_id.items():
        candidate = candidates.get(row_id)
        if candidate is None:
            continue
        lane = str(raw.get("memoryLane", ""))
        label_source = str(raw.get("resolvedLabelSource", "teacher"))
        confidence = float(raw.get("labelConfidence", 1 if label_source == "human" else 0))
        if lane not in LABEL_TO_ID:
            continue
        if confidence < minimum_confidence:
            low_confidence_excluded += 1
            continue
        # Local-teacher positives are proposals for human review, not training truth.
        if label_source == "teacher" and lane != "none":
            teacher_positive_excluded += 1
            continue
        rows.append(
            Row(
                id=row_id,
                segment_minus_2=str(candidate.get("segmentMinus2", "")),
                segment_minus_1=str(candidate.get("segmentMinus1", "")),
                current=str(candidate.get("current", "")),
                label=LABEL_TO_ID[lane],
                group=str(candidate.get("group") or row_id),
                origin=str(candidate.get("origin", "unknown")),
                confidence=confidence,
                label_source=label_source,
            )
        )
    if not rows:
        raise RuntimeError("no eligible memory-router rows")
    return rows, {
        "candidate_rows": len(candidates),
        "teacher_label_rows": len(teacher_labels),
        "human_label_rows": len(human_labels),
        "teacher_positive_excluded": teacher_positive_excluded,
        "low_confidence_excluded": low_confidence_excluded,
        "resolved_training_rows": len(rows),
    }


def serialize(row: Row) -> str:
    return (
        f"<SEG_MINUS_2> {row.segment_minus_2} "
        f"<SEG_MINUS_1> {row.segment_minus_1} "
        f"<CURRENT> {row.current}"
    )


def fingerprint(rows: list[Row]) -> str:
    digest = hashlib.sha256()
    for row in sorted(rows, key=lambda item: item.id):
        digest.update(f"{row.id}\t{row.group}\t{row.label}\t{serialize(row)}\n".encode("utf-8"))
    return digest.hexdigest()


class RowDataset(Dataset):
    def __init__(self, rows: list[Row]):
        self.rows = rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> tuple[str, int]:
        row = self.rows[index]
        return serialize(row), row.label


class Collator:
    def __init__(self, tokenizer):
        self.tokenizer = tokenizer

    def __call__(self, batch: list[tuple[str, int]]) -> dict[str, torch.Tensor]:
        texts, labels = zip(*batch)
        encoded = self.tokenizer(
            list(texts),
            padding=True,
            truncation=True,
            max_length=MAX_LENGTH,
            return_tensors="pt",
        )
        encoded["labels"] = torch.tensor(labels, dtype=torch.long)
        return encoded


def make_loader(rows: list[Row], tokenizer, shuffle: bool, seed: int) -> DataLoader:
    generator = torch.Generator()
    generator.manual_seed(seed)
    return DataLoader(
        RowDataset(rows),
        batch_size=BATCH_SIZE,
        shuffle=shuffle,
        num_workers=0,
        collate_fn=Collator(tokenizer),
        generator=generator,
    )


def split_rows(rows: list[Row]) -> tuple[list[Row], list[Row], list[Row]]:
    augmentation_groups = {row.group for row in rows if row.origin == "augmentation"}
    forced_train = [row for row in rows if row.group in augmentation_groups]
    splittable = [row for row in rows if row.group not in augmentation_groups]
    labels = np.asarray([row.label for row in splittable], dtype=np.int64)
    groups = np.asarray([row.group for row in splittable], dtype=object)
    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED)
    selected: tuple[list[Row], list[Row], list[Row]] | None = None
    for remaining_index, test_index in outer.split(np.zeros((len(splittable), 1)), labels, groups):
        remaining = [splittable[index] for index in remaining_index]
        test = [splittable[index] for index in test_index]
        remaining_labels = np.asarray([row.label for row in remaining], dtype=np.int64)
        remaining_groups = np.asarray([row.group for row in remaining], dtype=object)
        inner = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED + 1)
        for train_index, validation_index in inner.split(
            np.zeros((len(remaining), 1)), remaining_labels, remaining_groups
        ):
            train = [remaining[index] for index in train_index] + forced_train
            validation = [remaining[index] for index in validation_index]
            if all(len({row.label for row in split}) == len(LANES) for split in (train, validation, test)):
                selected = (train, validation, test)
                break
        if selected is not None:
            break
    if selected is None:
        raise RuntimeError("memory-router could not find a group-safe split containing all classes")
    train, validation, test = selected
    split_groups = [set(row.group for row in split) for split in (train, validation, test)]
    if split_groups[0] & split_groups[1] or split_groups[0] & split_groups[2] or split_groups[1] & split_groups[2]:
        raise RuntimeError("memory-router group leakage")
    for name, split in (("train", train), ("validation", validation), ("test", test)):
        present = {row.label for row in split}
        missing = [LANES[label] for label in range(len(LANES)) if label not in present]
        if missing:
            raise RuntimeError(f"memory-router {name} split is missing classes: {', '.join(missing)}")
    if any(row.origin == "augmentation" for row in validation + test):
        raise RuntimeError("memory-router augmentation leaked outside the training split")
    return train, validation, test


def balanced_weights(rows: list[Row]) -> torch.Tensor:
    counts = collections.Counter(row.label for row in rows)
    maximum = max(counts.values())
    # Each class should contribute the same total loss. Square-root weighting
    # still lets the large teacher-negative pool dominate the scarce human
    # memory lanes, which makes missed memory requests much more likely.
    weights = [maximum / max(1, counts.get(index, 0)) for index in range(len(LANES))]
    mean = sum(weights) / len(weights)
    return torch.tensor([weight / mean for weight in weights], dtype=torch.float32)


def freeze_encoder(model) -> None:
    for parameter in model.parameters():
        parameter.requires_grad = False
    for parameter in model.pre_classifier.parameters():
        parameter.requires_grad = True
    for parameter in model.classifier.parameters():
        parameter.requires_grad = True


def unfreeze_top_two(model) -> None:
    freeze_encoder(model)
    for layer in model.distilbert.transformer.layer[-2:]:
        for parameter in layer.parameters():
            parameter.requires_grad = True


def create_model_and_tokenizer(base_model: pathlib.Path):
    tokenizer = AutoTokenizer.from_pretrained(base_model, local_files_only=True)
    tokenizer.truncation_side = "left"
    existing_tokens = set(tokenizer.special_tokens_map.get("additional_special_tokens", []))
    missing_tokens = [token for token in SPECIAL_TOKENS if token not in existing_tokens]
    if missing_tokens:
        tokenizer.add_special_tokens({"additional_special_tokens": missing_tokens})
    model = AutoModelForSequenceClassification.from_pretrained(
        base_model,
        local_files_only=True,
        num_labels=len(LANES),
        id2label=ID_TO_LABEL,
        label2id=LABEL_TO_ID,
        ignore_mismatched_sizes=True,
    )
    model.resize_token_embeddings(len(tokenizer))
    return model, tokenizer


def optimizer_for(model, head_only: bool):
    if head_only:
        return torch.optim.AdamW(
            [parameter for parameter in model.parameters() if parameter.requires_grad],
            lr=5e-4,
            weight_decay=0.01,
        )
    encoder, head = [], []
    for name, parameter in model.named_parameters():
        if not parameter.requires_grad:
            continue
        (head if name.startswith(("pre_classifier", "classifier")) else encoder).append(parameter)
    return torch.optim.AdamW(
        [
            {"params": encoder, "lr": 2e-5},
            {"params": head, "lr": 1e-4},
        ],
        weight_decay=0.01,
    )


def train_epoch(model, loader, optimizer, class_weights: torch.Tensor, scheduler=None) -> float:
    model.train()
    optimizer.zero_grad(set_to_none=True)
    total_loss = 0.0
    for step, batch in enumerate(loader, start=1):
        labels = batch.pop("labels")
        logits = model(**batch).logits
        loss = functional.cross_entropy(logits, labels, weight=class_weights)
        (loss / GRADIENT_ACCUMULATION).backward()
        total_loss += float(loss.detach())
        if step % GRADIENT_ACCUMULATION == 0 or step == len(loader):
            torch.nn.utils.clip_grad_norm_(
                [parameter for parameter in model.parameters() if parameter.requires_grad], 1.0
            )
            optimizer.step()
            if scheduler is not None:
                scheduler.step()
            optimizer.zero_grad(set_to_none=True)
    return total_loss / max(len(loader), 1)


def predict(model, rows: list[Row], tokenizer) -> tuple[np.ndarray, np.ndarray]:
    labels, predictions = [], []
    model.eval()
    with torch.inference_mode():
        for batch in make_loader(rows, tokenizer, shuffle=False, seed=SEED):
            labels.extend(batch.pop("labels").numpy().tolist())
            predictions.extend(model(**batch).logits.argmax(dim=1).numpy().tolist())
    return np.asarray(labels), np.asarray(predictions)


def evaluate(model, rows: list[Row], tokenizer) -> dict[str, object]:
    labels, predictions = predict(model, rows, tokenizer)
    return {
        "macro_f1": float(f1_score(labels, predictions, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(labels, predictions, average="weighted", zero_division=0)),
        "classification_report": classification_report(
            labels,
            predictions,
            labels=list(range(len(LANES))),
            target_names=LANES,
            output_dict=True,
            zero_division=0,
        ),
        "confusion_matrix": confusion_matrix(labels, predictions, labels=list(range(len(LANES)))).tolist(),
    }


def class_distribution(rows: list[Row]) -> dict[str, int]:
    counts = collections.Counter(row.label for row in rows)
    return {LANES[index]: counts.get(index, 0) for index in range(len(LANES))}


def label_source_distribution(rows: list[Row]) -> dict[str, int]:
    return dict(collections.Counter(row.label_source for row in rows))


def balanced_smoke_rows(rows: list[Row], per_class: int = 8) -> list[Row]:
    selected = []
    for label in range(len(LANES)):
        selected.extend([row for row in rows if row.label == label][:per_class])
    return selected


def main() -> None:
    args = parse_args()
    set_seed(SEED)
    torch.set_num_threads(max(1, min(12, os.cpu_count() or 1)))
    input_path = pathlib.Path(args.input).resolve()
    human_label_path = pathlib.Path(args.human_labels).resolve()
    candidate_path = pathlib.Path(args.candidates).resolve()
    output_path = pathlib.Path(args.output).resolve()
    base_model = pathlib.Path(args.base_model).resolve()
    if output_path.exists() and not args.smoke:
        raise RuntimeError(f"output already exists: {output_path}")
    rows, label_diagnostics = load_rows(input_path, candidate_path, human_label_path, args.minimum_confidence)
    train_rows, validation_rows, test_rows = split_rows(rows)
    if args.smoke:
        train_rows = balanced_smoke_rows(train_rows)
        validation_rows = balanced_smoke_rows(validation_rows, per_class=4)
    print(json.dumps({
        "rows": len(rows),
        "train": len(train_rows),
        "validation": len(validation_rows),
        "test": len(test_rows),
        "train_distribution": class_distribution(train_rows),
        "validation_distribution": class_distribution(validation_rows),
        "test_distribution": class_distribution(test_rows),
        "label_sources": label_source_distribution(rows),
        "label_diagnostics": label_diagnostics,
    }, indent=2), flush=True)
    if args.validate_only:
        print("VALIDATION_OK", flush=True)
        return

    model, tokenizer = create_model_and_tokenizer(base_model)
    train_loader = make_loader(train_rows, tokenizer, shuffle=True, seed=SEED)
    class_weights = balanced_weights(train_rows)
    best_state = None
    best_score = -1.0
    records = []
    started_at = time.time()

    freeze_encoder(model)
    optimizer = optimizer_for(model, head_only=True)
    for epoch in range(1, HEAD_EPOCHS + 1):
        loss = train_epoch(model, train_loader, optimizer, class_weights)
        metrics = evaluate(model, validation_rows, tokenizer)
        score = float(metrics["macro_f1"])
        records.append({"stage": "head", "epoch": epoch, "loss": loss, **metrics})
        print(f"head epoch={epoch} loss={loss:.6f} macro_f1={score:.4f}", flush=True)
        if score > best_score:
            best_score = score
            best_state = copy.deepcopy({name: value.detach().cpu() for name, value in model.state_dict().items()})

    unfreeze_top_two(model)
    optimizer = optimizer_for(model, head_only=False)
    updates_per_epoch = math.ceil(len(train_loader) / GRADIENT_ACCUMULATION)
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=max(1, int(updates_per_epoch * TOP_EPOCHS * 0.1)),
        num_training_steps=updates_per_epoch * TOP_EPOCHS,
    )
    for epoch in range(1, (1 if args.smoke else TOP_EPOCHS) + 1):
        loss = train_epoch(model, train_loader, optimizer, class_weights, scheduler)
        metrics = evaluate(model, validation_rows, tokenizer)
        score = float(metrics["macro_f1"])
        records.append({"stage": "top2", "epoch": epoch, "loss": loss, **metrics})
        print(f"top2 epoch={epoch} loss={loss:.6f} macro_f1={score:.4f}", flush=True)
        if score > best_score:
            best_score = score
            best_state = copy.deepcopy({name: value.detach().cpu() for name, value in model.state_dict().items()})

    if args.smoke:
        print("SMOKE_OK", flush=True)
        return
    assert best_state is not None
    model.load_state_dict(best_state)
    test_metrics = evaluate(model, test_rows, tokenizer)
    output_path.mkdir(parents=True, exist_ok=False)
    model.save_pretrained(output_path, safe_serialization=True)
    tokenizer.save_pretrained(output_path)
    report = {
        "artifact": "saynext_memory_router_v1",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "labels": ID_TO_LABEL,
        "input_contract": "transcript-only: <SEG_MINUS_2> ... <SEG_MINUS_1> ... <CURRENT> ...",
        "prohibited_model_input": ["sourceRef", "origin", "group", "teacherModel", "labelConfidence"],
        "rows": len(rows),
        "train_rows": len(train_rows),
        "validation_rows": len(validation_rows),
        "test_rows": len(test_rows),
        "distributions": {
            "all": class_distribution(rows),
            "train": class_distribution(train_rows),
            "validation": class_distribution(validation_rows),
            "test": class_distribution(test_rows),
        },
        "label_sources": label_source_distribution(rows),
        "label_diagnostics": label_diagnostics,
        "training_data_sha256": fingerprint(rows),
        "best_validation_macro_f1": best_score,
        "selection_records": records,
        "held_out_test": test_metrics,
        "elapsed_seconds": round(time.time() - started_at, 3),
        "max_length": MAX_LENGTH,
        "truncation_side": "left",
    }
    (output_path / "training_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"saved": str(output_path), "held_out_test": test_metrics}, indent=2), flush=True)


if __name__ == "__main__":
    main()
