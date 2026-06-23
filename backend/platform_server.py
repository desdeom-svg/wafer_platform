from __future__ import annotations

import base64
import ctypes
import csv
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import zipfile
from dataclasses import asdict, dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parents[2]
PLATFORM_DIR = ROOT_DIR / "wafer_platform"
DIST_DIR = PLATFORM_DIR / "dist"
STORAGE_DIR = PLATFORM_DIR / "storage"
DB_PATH = STORAGE_DIR / "platform.db"

sys.path.insert(0, str(ROOT_DIR / "src"))
from wafer_tinycnn.dataset import collect_dataset_samples, find_named_image, is_image_file, is_sample_folder  # noqa: E402


TRAINING_PROCESSES: dict[str, subprocess.Popen[str]] = {}

TRAINING_DEFAULTS: dict[str, Any] = {
    "epochs": 500,
    "batchSize": 128,
    "lr": 0.0002,
    "warmupEpochs": 3,
    "valRatio": 0.1,
    "inputSize": 32,
    "arch": "tinycnn",
    "inputMode": "raw3",
    "intensityNorm": "robust",
    "norm": "group",
    "pooling": "avgmax",
    "balancedSampler": 0,
    "ngHardAugRepeat": 1,
    "guardNgTrainRepeat": 2,
    "earlyStop": 0,
    "selectionMode": "fp-under-fn-cap",
    "maxValFn": 2,
    "maxGuardFn": 15,
    "posWeight": "auto",
    "loss": "bce",
    "minThreshold": 0.05,
    "thresholdMargin": 0.03,
    "maxThreshold": 0.75,
    "seed": 42,
    "device": "cpu",
    "numWorkers": 4,
    "amp": 0,
    "channelsLast": 0,
    "prefetchFactor": 4,
    "evalEvery": 1,
    "guardEvalEvery": 5,
    "cudnnBenchmark": 0,
}

_CPU_SAMPLE: tuple[int, int] | None = None


@dataclass
class ApiError(Exception):
    status: int
    message: str


def utc_id(prefix: str) -> str:
    return f"{prefix}-{time.strftime('%Y%m%d-%H%M%S')}"


def now_text() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _filetime_to_int(filetime: Any) -> int:
    return (int(filetime.dwHighDateTime) << 32) + int(filetime.dwLowDateTime)


def _windows_cpu_percent() -> float:
    global _CPU_SAMPLE
    if not sys.platform.startswith("win"):
        return 0.0

    class FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]

    idle = FILETIME()
    kernel = FILETIME()
    user = FILETIME()
    if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        return 0.0

    idle_time = _filetime_to_int(idle)
    total_time = _filetime_to_int(kernel) + _filetime_to_int(user)
    if _CPU_SAMPLE is None:
        _CPU_SAMPLE = (idle_time, total_time)
        return 0.0

    previous_idle, previous_total = _CPU_SAMPLE
    _CPU_SAMPLE = (idle_time, total_time)
    total_delta = max(1, total_time - previous_total)
    idle_delta = max(0, idle_time - previous_idle)
    return max(0.0, min(100.0, (1.0 - idle_delta / total_delta) * 100.0))


def get_system_metrics() -> dict[str, Any]:
    memory_total_gb = 0.0
    memory_used_gb = 0.0
    memory_percent = 0.0
    if sys.platform.startswith("win"):
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            memory_total_gb = status.ullTotalPhys / (1024 ** 3)
            memory_used_gb = (status.ullTotalPhys - status.ullAvailPhys) / (1024 ** 3)
            memory_percent = float(status.dwMemoryLoad)

    return {
        "cpuPercent": round(_windows_cpu_percent(), 1),
        "memoryPercent": round(memory_percent, 1),
        "memoryUsedGb": round(memory_used_gb, 2),
        "memoryTotalGb": round(memory_total_gb, 2),
        "updatedAt": now_text(),
        "cpuThreads": os.cpu_count() or 1,
    }


def ensure_storage() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("datasets", "uploads", "runs", "exports"):
        (STORAGE_DIR / name).mkdir(parents=True, exist_ok=True)


def connect() -> sqlite3.Connection:
    ensure_storage()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS datasets (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              version TEXT NOT NULL,
              path TEXT NOT NULL,
              created_at TEXT NOT NULL,
              status TEXT NOT NULL,
              owner TEXT NOT NULL,
              ok_count INTEGER NOT NULL DEFAULT 0,
              ng_count INTEGER NOT NULL DEFAULT 0,
              hard_ok_count INTEGER NOT NULL DEFAULT 0,
              unlabeled_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS samples (
              id TEXT PRIMARY KEY,
              dataset_version_id TEXT NOT NULL,
              path TEXT NOT NULL,
              filename TEXT NOT NULL,
              source_lot TEXT NOT NULL,
              label TEXT NOT NULL,
              decision TEXT NOT NULL,
              probability_ng REAL NOT NULL DEFAULT 0,
              risk TEXT NOT NULL DEFAULT 'low',
              image_tone TEXT NOT NULL DEFAULT 'neutral',
              FOREIGN KEY(dataset_version_id) REFERENCES datasets(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS training_runs (
              id TEXT PRIMARY KEY,
              dataset_version_id TEXT NOT NULL,
              model_name TEXT NOT NULL,
              status TEXT NOT NULL,
              progress REAL NOT NULL DEFAULT 0,
              started_at TEXT NOT NULL,
              epochs INTEGER NOT NULL,
              current_epoch INTEGER NOT NULL DEFAULT 0,
              run_dir TEXT NOT NULL,
              logs TEXT NOT NULL DEFAULT '[]',
              metrics TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS models (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              version TEXT NOT NULL,
              dataset_version_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              weights_path TEXT NOT NULL,
              recall_ng REAL NOT NULL DEFAULT 0,
              false_negative INTEGER NOT NULL DEFAULT 0,
              false_positive INTEGER NOT NULL DEFAULT 0,
              threshold REAL NOT NULL DEFAULT 0.5,
              format TEXT NOT NULL DEFAULT 'pt',
              production INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS inference_jobs (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              mode TEXT NOT NULL,
              status TEXT NOT NULL,
              total INTEGER NOT NULL,
              ng_count INTEGER NOT NULL,
              ok_count INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              report_path TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS evaluations (
              id TEXT PRIMARY KEY,
              model_version_id TEXT NOT NULL,
              dataset_version_id TEXT NOT NULL,
              recall_ng REAL NOT NULL DEFAULT 0,
              accuracy REAL NOT NULL DEFAULT 0,
              false_negative INTEGER NOT NULL DEFAULT 0,
              false_positive INTEGER NOT NULL DEFAULT 0,
              threshold REAL NOT NULL DEFAULT 0.5,
              confusion TEXT NOT NULL DEFAULT '{}',
              report_path TEXT NOT NULL DEFAULT ''
            );
            """
        )


def row_to_dataset(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "version": row["version"],
        "createdAt": row["created_at"],
        "status": row["status"],
        "okCount": row["ok_count"],
        "ngCount": row["ng_count"],
        "hardOkCount": row["hard_ok_count"],
        "unlabeledCount": row["unlabeled_count"],
        "owner": row["owner"],
        "path": row["path"],
    }


def row_to_sample(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "datasetVersionId": row["dataset_version_id"],
        "filename": row["filename"],
        "sourceLot": row["source_lot"],
        "label": row["label"],
        "decision": row["decision"],
        "probabilityNg": row["probability_ng"],
        "risk": row["risk"],
        "imageTone": row["image_tone"],
        "path": row["path"],
    }


def row_to_run(row: sqlite3.Row) -> dict[str, Any]:
    logs = json.loads(row["logs"] or "[]")
    metrics = json.loads(row["metrics"] or "[]")
    if not metrics:
        metrics = [metric for line in logs if (metric := parse_training_metric(line)) is not None]
    return {
        "id": row["id"],
        "datasetVersionId": row["dataset_version_id"],
        "modelName": row["model_name"],
        "status": row["status"],
        "progress": row["progress"],
        "startedAt": row["started_at"],
        "epochs": row["epochs"],
        "currentEpoch": row["current_epoch"],
        "metrics": metrics,
        "logs": logs,
        "runDir": row["run_dir"],
    }


def read_model_training_info(weights_path: str) -> dict[str, Any]:
    run_dir = Path(weights_path).parent if weights_path else None
    info: dict[str, Any] = {}
    if run_dir:
        info["runDir"] = str(run_dir)
        for filename in ("threshold.json", "config.json"):
            meta_path = run_dir / filename
            if not meta_path.exists():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            config = meta.get("config") if isinstance(meta, dict) else None
            if isinstance(config, dict):
                info["trainingConfig"] = config
            elif isinstance(meta, dict):
                known_keys = {
                    "epochs",
                    "batchSize",
                    "batch_size",
                    "lr",
                    "arch",
                    "inputMode",
                    "input_mode",
                    "intensityNorm",
                    "intensity_norm",
                    "selectionMode",
                    "selection_mode",
                    "threshold",
                }
                picked = {key: value for key, value in meta.items() if key in known_keys}
                if picked:
                    info["trainingConfig"] = picked
            if "trainingConfig" in info:
                break
    return info


def row_to_model(row: sqlite3.Row) -> dict[str, Any]:
    model_id = row["id"]
    model = {
        "id": row["id"],
        "name": row["name"],
        "version": row["version"],
        "datasetVersionId": row["dataset_version_id"],
        "createdAt": row["created_at"],
        "weightsPath": row["weights_path"],
        "recallNg": row["recall_ng"],
        "falseNegative": row["false_negative"],
        "falsePositive": row["false_positive"],
        "threshold": row["threshold"],
        "format": row["format"],
        "production": bool(row["production"]),
    }
    if model_id.startswith("model-"):
        model["runId"] = model_id.removeprefix("model-")
    model.update(read_model_training_info(row["weights_path"]))
    return model


def scan_dataset(path: Path, name: str | None = None, owner: str = "local") -> dict[str, Any]:
    if not path.exists():
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Dataset path does not exist: {path}")
    samples = collect_dataset_samples(path)
    if not samples:
        raise ApiError(HTTPStatus.BAD_REQUEST, "No OK/NG wafer samples found in the dataset")

    dataset_id = utc_id("ds")
    version = f"v{int(time.time())}"
    counts = {
        "ok": sum(1 for sample in samples if sample.label == 0),
        "ng": sum(1 for sample in samples if sample.label == 1),
        "hard_ok": 0,
        "unlabeled": 0,
    }
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO datasets
              (id, name, version, path, created_at, status, owner, ok_count, ng_count, hard_ok_count, unlabeled_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                name or path.name or "Wafer Dataset",
                version,
                str(path),
                now_text(),
                "ready",
                owner,
                counts["ok"],
                counts["ng"],
                counts["hard_ok"],
                counts["unlabeled"],
            ),
        )
        rows = []
        for index, sample in enumerate(samples):
            label = "NG" if sample.label == 1 else "OK"
            rows.append(
                (
                    f"{dataset_id}-sample-{index:06d}",
                    dataset_id,
                    str(sample.path),
                    sample.path.name,
                    sample.path.parent.name,
                    label,
                    label,
                    0.0,
                    "low",
                    "neutral",
                )
            )
        conn.executemany(
            """
            INSERT INTO samples
              (id, dataset_version_id, path, filename, source_lot, label, decision, probability_ng, risk, image_tone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    return get_state()


def upload_zip(payload: dict[str, Any]) -> dict[str, Any]:
    filename = str(payload.get("filename") or "dataset.zip")
    data_url = str(payload.get("contentBase64") or "")
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    if not data_url:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Missing ZIP content")
    upload_id = utc_id("upload")
    upload_dir = STORAGE_DIR / "uploads" / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    zip_path = upload_dir / filename
    zip_path.write_bytes(base64.b64decode(data_url))
    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        zip_ref.extractall(upload_dir / "extracted")
    extracted_root = upload_dir / "extracted"
    candidates = [extracted_root] + [p for p in extracted_root.iterdir() if p.is_dir()]
    dataset_root = next((p for p in candidates if (p / "OK").exists() or (p / "NG").exists()), extracted_root)
    stored_root = STORAGE_DIR / "datasets" / upload_id
    if stored_root.exists():
        shutil.rmtree(stored_root)
    shutil.copytree(dataset_root, stored_root)
    return scan_dataset(stored_root, name=payload.get("name") or Path(filename).stem, owner="upload")


def import_dataset_directory(path: Path, name: str | None = None, owner: str = "local") -> dict[str, Any]:
    if not path.exists() or not path.is_dir():
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Dataset directory does not exist: {path}")
    import_id = utc_id("import")
    stored_root = STORAGE_DIR / "datasets" / import_id
    shutil.copytree(path, stored_root)
    return scan_dataset(stored_root, name=name or path.name, owner=owner)


def rename_dataset(dataset_id: str, name: str) -> dict[str, Any]:
    clean_name = name.strip()
    if not clean_name:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Dataset name is required")
    with connect() as conn:
        cur = conn.execute("UPDATE datasets SET name=? WHERE id=?", (clean_name, dataset_id))
        if cur.rowcount == 0:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Dataset not found: {dataset_id}")
    return get_state()


def delete_dataset(dataset_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT path FROM datasets WHERE id=?", (dataset_id,)).fetchone()
        if not row:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Dataset not found: {dataset_id}")
        conn.execute("DELETE FROM datasets WHERE id=?", (dataset_id,))
    dataset_path = Path(row["path"])
    try:
        if dataset_path.exists() and STORAGE_DIR.resolve() in dataset_path.resolve().parents:
            shutil.rmtree(dataset_path)
    except Exception:
        pass
    return get_state()


def get_state() -> dict[str, Any]:
    with connect() as conn:
        datasets = [row_to_dataset(row) for row in conn.execute("SELECT * FROM datasets ORDER BY created_at DESC")]
        samples = [row_to_sample(row) for row in conn.execute("SELECT * FROM samples ORDER BY dataset_version_id DESC, id LIMIT 1200")]
        runs = [row_to_run(row) for row in conn.execute("SELECT * FROM training_runs ORDER BY started_at DESC")]
        models = [row_to_model(row) for row in conn.execute("SELECT * FROM models ORDER BY created_at DESC")]
        inference = [dict(row) for row in conn.execute("SELECT * FROM inference_jobs ORDER BY created_at DESC")]
        evaluations = [dict(row) for row in conn.execute("SELECT * FROM evaluations ORDER BY id DESC")]
    return {
        "datasets": datasets,
        "samples": samples,
        "trainingRuns": runs,
        "models": models,
        "inferenceJobs": [
            {
                "id": row["id"],
                "name": row["name"],
                "mode": row["mode"],
                "status": row["status"],
                "total": row["total"],
                "ngCount": row["ng_count"],
                "okCount": row["ok_count"],
                "createdAt": row["created_at"],
                "reportPath": row["report_path"],
            }
            for row in inference
        ],
        "evaluations": [
            {
                "id": row["id"],
                "modelVersionId": row["model_version_id"],
                "datasetVersionId": row["dataset_version_id"],
                "recallNg": row["recall_ng"],
                "accuracy": row["accuracy"],
                "falseNegative": row["false_negative"],
                "falsePositive": row["false_positive"],
                "threshold": row["threshold"],
                "confusion": json.loads(row["confusion"] or "{}"),
                "reportPath": row["report_path"],
            }
            for row in evaluations
        ],
        "storageDir": str(STORAGE_DIR),
        "systemMetrics": get_system_metrics(),
    }


def get_dataset_samples(dataset_id: str) -> dict[str, Any]:
    with connect() as conn:
        if not conn.execute("SELECT id FROM datasets WHERE id=?", (dataset_id,)).fetchone():
            raise ApiError(HTTPStatus.NOT_FOUND, f"Dataset not found: {dataset_id}")
        samples = [row_to_sample(row) for row in conn.execute("SELECT * FROM samples WHERE dataset_version_id=? ORDER BY id", (dataset_id,))]
    return {"datasetVersionId": dataset_id, "samples": samples}


def set_sample_decision(sample_id: str, decision: str) -> dict[str, Any]:
    allowed = {"OK", "NG", "OK_HARD", "IGNORE", "UNLABELED"}
    if decision not in allowed:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Unsupported decision: {decision}")
    with connect() as conn:
        cur = conn.execute("UPDATE samples SET decision=? WHERE id=?", (decision, sample_id))
        if cur.rowcount == 0:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Sample not found: {sample_id}")
    return get_state()


def get_sample_image_path(sample_id: str, kind: str) -> Path:
    with connect() as conn:
        row = conn.execute("SELECT path FROM samples WHERE id=?", (sample_id,)).fetchone()
    if not row:
        raise ApiError(HTTPStatus.NOT_FOUND, f"Sample not found: {sample_id}")

    sample_path = Path(row["path"])
    if sample_path.is_file() and is_image_file(sample_path):
        return sample_path
    if not sample_path.is_dir():
        raise ApiError(HTTPStatus.NOT_FOUND, f"Sample image not found: {sample_path}")

    if kind == "triptych":
        for stem in ("triptych", "stitched", "combined", "image"):
            named_triptych = find_named_image(sample_path, stem)
            if named_triptych and named_triptych.exists():
                return named_triptych
        for child in sample_path.iterdir():
            if child.is_file() and is_image_file(child):
                return child

    image_kind = kind if kind in {"current", "ref1", "ref2"} else "current"
    named = find_named_image(sample_path, image_kind)
    if named and named.exists():
        return named

    for child in sample_path.iterdir():
        if child.is_file() and is_image_file(child):
            return child
    raise ApiError(HTTPStatus.NOT_FOUND, f"No image file found for sample: {sample_id}")


def parse_training_metric(line: str) -> dict[str, Any] | None:
    key_values = dict(re.findall(r"([a-zA-Z_]+)=([^\s]+)", line))
    if "epoch" not in key_values or "loss" not in key_values or "recall_ng" not in key_values:
        return None
    try:
        return {
            "epoch": int(key_values["epoch"]),
            "loss": float(key_values["loss"]),
            "recallNg": float(key_values.get("recall_ng", 0.0)),
            "falseNegative": int(key_values.get("fn", 0)),
            "falsePositive": int(key_values.get("fp", 0)),
            "threshold": float(key_values.get("threshold", 0.0).replace("floor", "")),
        }
    except ValueError:
        return None


def parse_training_progress(line: str, epochs: int) -> tuple[float | None, int | None]:
    epoch_match = re.search(r"\bepoch=(\d+)\b", line)
    if not epoch_match:
        return None, None
    try:
        epoch = int(epoch_match.group(1))
    except ValueError:
        return None, None

    batch_match = re.search(r"\bbatch=(\d+)/(\d+)\b", line)
    if batch_match:
        try:
            batch_index = int(batch_match.group(1))
            batch_total = max(1, int(batch_match.group(2)))
            fractional_epoch = max(0.0, min(1.0, batch_index / batch_total))
            return min(1.0, ((epoch - 1) + fractional_epoch) / max(1, epochs)), epoch
        except ValueError:
            return None, epoch

    return min(1.0, epoch / max(1, epochs)), epoch


def append_run_log(
    run_id: str,
    line: str,
    progress: float | None = None,
    current_epoch: int | None = None,
    metric: dict[str, Any] | None = None,
) -> None:
    with connect() as conn:
        row = conn.execute("SELECT logs, metrics FROM training_runs WHERE id=?", (run_id,)).fetchone()
        logs = json.loads(row["logs"] or "[]") if row else []
        logs.append(line.rstrip())
        fields: list[str] = ["logs=?"]
        values: list[Any] = [json.dumps(logs, ensure_ascii=False)]
        if metric is not None:
            metrics = json.loads(row["metrics"] or "[]") if row else []
            metrics = [item for item in metrics if item.get("epoch") != metric["epoch"]]
            metrics.append(metric)
            metrics.sort(key=lambda item: item.get("epoch", 0))
            fields.append("metrics=?")
            values.append(json.dumps(metrics, ensure_ascii=False))
        if progress is not None:
            fields.append("progress=?")
            values.append(progress)
        if current_epoch is not None:
            fields.append("current_epoch=?")
            values.append(current_epoch)
        values.append(run_id)
        conn.execute(f"UPDATE training_runs SET {', '.join(fields)} WHERE id=?", values)


def start_training(payload: dict[str, Any]) -> dict[str, Any]:
    dataset_id = str(payload.get("datasetVersionId") or "")
    with connect() as conn:
        dataset = conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
    if not dataset:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Select a real dataset before training")

    config = dict(TRAINING_DEFAULTS)
    incoming_config = payload.get("config")
    if isinstance(incoming_config, dict):
        for key in TRAINING_DEFAULTS:
            if key in incoming_config:
                config[key] = incoming_config[key]
    epochs = int(config["epochs"])
    run_id = utc_id("run")
    run_dir = STORAGE_DIR / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    model_name = str(payload.get("modelName") or f"{config['arch']}-{config['inputMode']}-{config['intensityNorm']}")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO training_runs
              (id, dataset_version_id, model_name, status, progress, started_at, epochs, current_epoch, run_dir, logs, metrics)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (run_id, dataset_id, model_name, "running", 0, now_text(), epochs, 0, str(run_dir), "[]", "[]"),
        )

    thread = threading.Thread(target=run_training_process, args=(run_id, Path(dataset["path"]), run_dir, config), daemon=True)
    thread.start()
    return get_state()


def run_training_process(run_id: str, dataset_path: Path, run_dir: Path, config: dict[str, Any]) -> None:
    epochs = int(config["epochs"])
    cmd = [
        sys.executable,
        "-u",
        str(ROOT_DIR / "train.py"),
        "--data",
        str(dataset_path),
        "--out",
        str(run_dir),
        "--epochs",
        str(epochs),
        "--batch-size",
        str(config["batchSize"]),
        "--lr",
        str(config["lr"]),
        "--warmup-epochs",
        str(config["warmupEpochs"]),
        "--val-ratio",
        str(config["valRatio"]),
        "--input-size",
        str(config["inputSize"]),
        "--arch",
        str(config["arch"]),
        "--input-mode",
        str(config["inputMode"]),
        "--intensity-norm",
        str(config["intensityNorm"]),
        "--pooling",
        str(config["pooling"]),
        "--norm",
        str(config["norm"]),
        "--balanced-sampler",
        str(config["balancedSampler"]),
        "--ng-hard-aug-repeat",
        str(config["ngHardAugRepeat"]),
        "--guard-ng-train-repeat",
        str(config["guardNgTrainRepeat"]),
        "--early-stop",
        str(config["earlyStop"]),
        "--selection-mode",
        str(config["selectionMode"]),
        "--max-val-fn",
        str(config["maxValFn"]),
        "--max-guard-fn",
        str(config["maxGuardFn"]),
        "--pos-weight",
        str(config["posWeight"]),
        "--loss",
        str(config["loss"]),
        "--min-threshold",
        str(config["minThreshold"]),
        "--threshold-margin",
        str(config["thresholdMargin"]),
        "--max-threshold",
        str(config["maxThreshold"]),
        "--seed",
        str(config["seed"]),
        "--device",
        str(config["device"]),
        "--num-workers",
        str(config["numWorkers"]),
        "--amp",
        str(config["amp"]),
        "--channels-last",
        str(config["channelsLast"]),
        "--prefetch-factor",
        str(config["prefetchFactor"]),
        "--eval-every",
        str(config["evalEvery"]),
        "--guard-eval-every",
        str(config["guardEvalEvery"]),
        "--cudnn-benchmark",
        str(config["cudnnBenchmark"]),
    ]
    append_run_log(run_id, "Starting: " + " ".join(cmd))
    try:
        process = subprocess.Popen(
            cmd,
            cwd=str(ROOT_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        TRAINING_PROCESSES[run_id] = process
        assert process.stdout is not None
        for line in process.stdout:
            metric = parse_training_metric(line)
            progress, current_epoch = parse_training_progress(line, epochs)
            append_run_log(run_id, line, progress=progress, current_epoch=current_epoch, metric=metric)
        code = process.wait()
        status = "completed" if code == 0 and (run_dir / "best.pt").exists() else "stopped"
        with connect() as conn:
            conn.execute("UPDATE training_runs SET status=?, progress=? WHERE id=?", (status, 1.0, run_id))
        if status == "completed":
            register_model_from_run(run_id, run_dir)
    except Exception as exc:
        append_run_log(run_id, f"Training failed: {exc}")
        with connect() as conn:
            conn.execute("UPDATE training_runs SET status=? WHERE id=?", ("stopped", run_id))
    finally:
        TRAINING_PROCESSES.pop(run_id, None)


def register_model_from_run(run_id: str, run_dir: Path) -> None:
    with connect() as conn:
        run = conn.execute("SELECT * FROM training_runs WHERE id=?", (run_id,)).fetchone()
    threshold_path = run_dir / "threshold.json"
    metrics = {}
    threshold = 0.5
    if threshold_path.exists():
        data = json.loads(threshold_path.read_text(encoding="utf-8"))
        metrics = data.get("metrics", {})
        threshold = float(data.get("threshold", threshold))
    model_id = utc_id("model")
    with connect() as conn:
        production_exists = conn.execute("SELECT COUNT(*) AS c FROM models WHERE production=1").fetchone()["c"] > 0
        conn.execute(
            """
            INSERT INTO models
              (id, name, version, dataset_version_id, created_at, weights_path, recall_ng, false_negative, false_positive, threshold, format, production)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                model_id,
                run["model_name"],
                model_id.replace("model-", "v"),
                run["dataset_version_id"],
                now_text(),
                str(run_dir / "best.pt"),
                float(metrics.get("recall_ng", 0)),
                int(metrics.get("false_negative", 0)),
                int(metrics.get("false_positive", 0)),
                threshold,
                "pt",
                0 if production_exists else 1,
            ),
        )


def stop_training(run_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT status FROM training_runs WHERE id=?", (run_id,)).fetchone()
    if not row:
        raise ApiError(HTTPStatus.NOT_FOUND, f"Training run not found: {run_id}")

    process = TRAINING_PROCESSES.get(run_id)
    if process and process.poll() is None:
        append_run_log(run_id, "Stop requested from platform UI")
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    with connect() as conn:
        conn.execute("UPDATE training_runs SET status=? WHERE id=?", ("stopped", run_id))
    return get_state()


def set_production_model(model_id: str) -> dict[str, Any]:
    with connect() as conn:
        if not conn.execute("SELECT id FROM models WHERE id=?", (model_id,)).fetchone():
            raise ApiError(HTTPStatus.NOT_FOUND, f"Model not found: {model_id}")
        conn.execute("UPDATE models SET production=0")
        conn.execute("UPDATE models SET production=1 WHERE id=?", (model_id,))
    return get_state()


def run_evaluation(payload: dict[str, Any]) -> dict[str, Any]:
    dataset_id = str(payload.get("datasetVersionId") or "")
    model_id = str(payload.get("modelVersionId") or "")
    with connect() as conn:
        dataset = conn.execute("SELECT * FROM datasets WHERE id=?", (dataset_id,)).fetchone()
        model = conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone()
    if not dataset or not model:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Dataset and model are required")
    eval_id = utc_id("eval")
    report_path = STORAGE_DIR / "runs" / eval_id / "eval_records.csv"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(ROOT_DIR / "eval.py"),
        "--data",
        str(dataset["path"]),
        "--weights",
        str(model["weights_path"]),
        "--csv",
        str(report_path),
    ]
    proc = subprocess.run(cmd, cwd=str(ROOT_DIR), text=True, capture_output=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, proc.stdout + proc.stderr)
    metrics = extract_json_object(proc.stdout)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO evaluations
              (id, model_version_id, dataset_version_id, recall_ng, accuracy, false_negative, false_positive, threshold, confusion, report_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                eval_id,
                model_id,
                dataset_id,
                float(metrics.get("recall_ng", 0)),
                float(metrics.get("accuracy", 0)),
                int(metrics.get("false_negative", 0)),
                int(metrics.get("false_positive", 0)),
                float(model["threshold"]),
                json.dumps(
                    {
                        "trueNg": int(metrics.get("true_positive", 0)),
                        "missedNg": int(metrics.get("false_negative", 0)),
                        "falseAlarmOk": int(metrics.get("false_positive", 0)),
                        "trueOk": int(metrics.get("true_negative", 0)),
                    }
                ),
                str(report_path),
            ),
        )
    return get_state()


def extract_json_object(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    return {}


def run_inference(payload: dict[str, Any]) -> dict[str, Any]:
    input_path = Path(str(payload.get("inputPath") or ""))
    model_id = str(payload.get("modelVersionId") or "")
    with connect() as conn:
        model = conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone()
    if not input_path.exists() or not model:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Input path and model are required")
    cmd = [sys.executable, str(ROOT_DIR / "predict.py"), "--input", str(input_path), "--weights", str(model["weights_path"])]
    proc = subprocess.run(cmd, cwd=str(ROOT_DIR), text=True, capture_output=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, proc.stdout + proc.stderr)
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    ng_count = sum(1 for line in lines if line.startswith("NG\t"))
    ok_count = sum(1 for line in lines if line.startswith("OK\t"))
    job_id = utc_id("infer")
    report_path = STORAGE_DIR / "runs" / job_id / "predictions.csv"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["raw"])
        writer.writerows([[line] for line in lines])
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO inference_jobs
              (id, name, mode, status, total, ng_count, ok_count, created_at, report_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (job_id, input_path.name, "single" if input_path.is_file() or is_sample_folder(input_path) else "batch", "completed", len(lines), ng_count, ok_count, now_text(), str(report_path)),
        )
    return get_state()


def export_model(model_id: str) -> dict[str, Any]:
    with connect() as conn:
        model = conn.execute("SELECT * FROM models WHERE id=?", (model_id,)).fetchone()
    if not model:
        raise ApiError(HTTPStatus.NOT_FOUND, f"Model not found: {model_id}")
    out_dir = STORAGE_DIR / "exports" / model_id
    out_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = out_dir / "model.onnx"
    cmd = [sys.executable, str(ROOT_DIR / "export_onnx.py"), "--weights", str(model["weights_path"]), "--out", str(onnx_path)]
    proc = subprocess.run(cmd, cwd=str(ROOT_DIR), text=True, capture_output=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, proc.stdout + proc.stderr)
    model_card = {
        "modelId": model_id,
        "name": model["name"],
        "version": model["version"],
        "datasetVersionId": model["dataset_version_id"],
        "threshold": model["threshold"],
        "exportedAt": now_text(),
    }
    (out_dir / "model_card.json").write_text(json.dumps(model_card, indent=2, ensure_ascii=False), encoding="utf-8")
    with connect() as conn:
        conn.execute("UPDATE models SET format=? WHERE id=?", ("pt+onnx", model_id))
    return {"state": get_state(), "exportDir": str(out_dir)}


def rename_model(model_id: str, name: str) -> dict[str, Any]:
    clean_name = name.strip()
    if not clean_name:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Model name is required")
    with connect() as conn:
        cur = conn.execute("UPDATE models SET name=? WHERE id=?", (clean_name, model_id))
        if cur.rowcount == 0:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Model not found: {model_id}")
    return get_state()


def delete_model(model_id: str) -> dict[str, Any]:
    with connect() as conn:
        cur = conn.execute("DELETE FROM models WHERE id=?", (model_id,))
        if cur.rowcount == 0:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Model not found: {model_id}")
        conn.execute("DELETE FROM evaluations WHERE model_version_id=?", (model_id,))
    return get_state()


def rename_inference_job(job_id: str, name: str) -> dict[str, Any]:
    clean_name = name.strip()
    if not clean_name:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Inference job name is required")
    with connect() as conn:
        cur = conn.execute("UPDATE inference_jobs SET name=? WHERE id=?", (clean_name, job_id))
        if cur.rowcount == 0:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Inference job not found: {job_id}")
    return get_state()


def delete_inference_job(job_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT report_path FROM inference_jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Inference job not found: {job_id}")
        conn.execute("DELETE FROM inference_jobs WHERE id=?", (job_id,))
    report_path = Path(row["report_path"] or "")
    try:
        if report_path.exists() and STORAGE_DIR.resolve() in report_path.resolve().parents:
            shutil.rmtree(report_path.parent)
    except Exception:
        pass
    return get_state()


def seed_from_local_data() -> None:
    with connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM datasets").fetchone()["c"]
    if count:
        return
    for candidate in (ROOT_DIR / "data_cleaned", ROOT_DIR / "Data"):
        if candidate.exists():
            try:
                scan_dataset(candidate, name=candidate.name, owner="bootstrap")
                return
            except ApiError:
                continue


class PlatformHandler(BaseHTTPRequestHandler):
    server_version = "WaferPlatform/0.1"

    def do_GET(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/health":
                self.send_json({"ok": True, "storageDir": str(STORAGE_DIR)})
            elif parsed.path == "/api/state":
                self.send_json(get_state())
            elif parsed.path.startswith("/api/datasets/") and parsed.path.endswith("/samples"):
                self.send_json(get_dataset_samples(parsed.path.split("/")[3]))
            elif parsed.path.startswith("/api/samples/") and parsed.path.endswith("/image"):
                sample_id = parsed.path.split("/")[3]
                kind = parse_qs(parsed.query).get("kind", ["triptych"])[0]
                self.handle_sample_image(sample_id, kind)
            elif parsed.path.startswith("/api/download"):
                self.handle_download(parsed.query)
            else:
                self.serve_static(parsed.path)
        except ApiError as exc:
            self.send_json({"error": exc.message}, exc.status)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self) -> None:
        try:
            parsed = urlparse(self.path)
            payload = self.read_json()
            if parsed.path == "/api/datasets/register":
                self.send_json(import_dataset_directory(Path(str(payload.get("path") or "")), payload.get("name"), payload.get("owner") or "local"))
            elif parsed.path == "/api/datasets/upload":
                self.send_json(upload_zip(payload))
            elif parsed.path.startswith("/api/datasets/") and parsed.path.endswith("/rename"):
                self.send_json(rename_dataset(parsed.path.split("/")[3], str(payload.get("name") or "")))
            elif parsed.path.startswith("/api/datasets/") and parsed.path.endswith("/delete"):
                self.send_json(delete_dataset(parsed.path.split("/")[3]))
            elif parsed.path.startswith("/api/samples/") and parsed.path.endswith("/decision"):
                sample_id = parsed.path.split("/")[3]
                self.send_json(set_sample_decision(sample_id, str(payload.get("decision") or "")))
            elif parsed.path == "/api/training-runs":
                self.send_json(start_training(payload))
            elif parsed.path.startswith("/api/training-runs/") and parsed.path.endswith("/stop"):
                self.send_json(stop_training(parsed.path.split("/")[3]))
            elif parsed.path == "/api/evaluations":
                self.send_json(run_evaluation(payload))
            elif parsed.path == "/api/inference-jobs":
                self.send_json(run_inference(payload))
            elif parsed.path.startswith("/api/inference-jobs/") and parsed.path.endswith("/rename"):
                self.send_json(rename_inference_job(parsed.path.split("/")[3], str(payload.get("name") or "")))
            elif parsed.path.startswith("/api/inference-jobs/") and parsed.path.endswith("/delete"):
                self.send_json(delete_inference_job(parsed.path.split("/")[3]))
            elif parsed.path.startswith("/api/models/") and parsed.path.endswith("/production"):
                self.send_json(set_production_model(parsed.path.split("/")[3]))
            elif parsed.path.startswith("/api/models/") and parsed.path.endswith("/rename"):
                self.send_json(rename_model(parsed.path.split("/")[3], str(payload.get("name") or "")))
            elif parsed.path.startswith("/api/models/") and parsed.path.endswith("/delete"):
                self.send_json(delete_model(parsed.path.split("/")[3]))
            elif parsed.path.startswith("/api/models/") and parsed.path.endswith("/export"):
                self.send_json(export_model(parsed.path.split("/")[3]))
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, f"Unknown endpoint: {parsed.path}")
        except ApiError as exc:
            self.send_json({"error": exc.message}, exc.status)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def serve_static(self, path_text: str) -> None:
        if not DIST_DIR.exists():
            raise ApiError(HTTPStatus.NOT_FOUND, "Build the frontend first with npm.cmd run build")
        path = path_text.lstrip("/") or "index.html"
        file_path = (DIST_DIR / path).resolve()
        if not str(file_path).startswith(str(DIST_DIR.resolve())) or not file_path.exists():
            file_path = DIST_DIR / "index.html"
        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_download(self, query: str) -> None:
        params = parse_qs(query)
        target = Path(params.get("path", [""])[0])
        if not target.exists():
            raise ApiError(HTTPStatus.NOT_FOUND, f"File not found: {target}")
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{target.name}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_sample_image(self, sample_id: str, kind: str) -> None:
        target = get_sample_image_path(sample_id, kind)
        data = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "image/png"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=60")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{now_text()}] {format % args}")


def main() -> int:
    init_db()
    host = "127.0.0.1"
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer((host, port), PlatformHandler)
    print(f"Wafer platform server: http://{host}:{port}")
    print(f"Storage: {STORAGE_DIR}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
