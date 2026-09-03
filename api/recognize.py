import base64
import json
import re
import unicodedata
from difflib import SequenceMatcher
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "ocr_models"
MAX_REQUEST_BYTES = 4_300_000
MAX_IMAGE_BYTES = 3_500_000


def _build_engine() -> RapidOCR:
    return RapidOCR(
        params={
            "Global.use_cls": False,
            "Global.text_score": 0.22,
            "Global.log_level": "warning",
            "Global.model_root_dir": str(MODEL_DIR),
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Det.lang_type": LangDet.MULTI,
            "Det.model_type": ModelType.SMALL,
            "Det.ocr_version": OCRVersion.PPOCRV6,
            "Det.model_path": str(MODEL_DIR / "PP-OCRv6_det_small.onnx"),
            "Det.limit_side_len": 1600,
            "Det.box_thresh": 0.28,
            "Det.unclip_ratio": 1.35,
            "Cls.model_path": str(
                MODEL_DIR / "ch_ppocr_mobile_v2.0_cls_mobile.onnx"
            ),
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.CYRILLIC,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_path": str(
                MODEL_DIR / "cyrillic_PP-OCRv5_rec_mobile.onnx"
            ),
            "Rec.rec_keys_path": str(MODEL_DIR / "ppocrv5_cyrillic_dict.txt"),
        }
    )


OCR_ENGINE = _build_engine()


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower().replace("ё", "е")
    value = re.sub(r"[^а-яa-z0-9!\- ]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def load_elements() -> list[str]:
    elements: dict[str, str] = {}
    for base in ("Земля", "Пламя", "Воздух", "Вода"):
        elements[normalize(base)] = base

    source = (ROOT / "app" / "data.txt").read_text(encoding="utf-8")
    for line in source.splitlines():
        unlock = re.match(r"^\s*\d+\.\s*ОТКРЫТИЕ\s+(.+?)\s*\(", line, re.I)
        recipe = re.match(r"^\s*\d+\.\s*.+?\s*\+\s*.+?\s*=\s*(.+?)\s*$", line)
        match = unlock or recipe
        if match:
            name = match.group(1).strip()
            elements[normalize(name)] = name
    return list(elements.values())


ELEMENTS = load_elements()


def prepare_image(image_bytes: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Не удалось прочитать изображение")

    height, width = image.shape[:2]
    longest = max(height, width)
    if longest > 2200:
        scale = 2200 / longest
    elif longest < 1400:
        scale = min(3.0, 1400 / longest)
    else:
        scale = 1.0

    if scale != 1.0:
        image = cv2.resize(
            image,
            None,
            fx=scale,
            fy=scale,
            interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA,
        )

    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)
    lightness = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(lightness)
    return cv2.cvtColor(cv2.merge((lightness, channel_a, channel_b)), cv2.COLOR_LAB2BGR)


def similarity(ocr_text: str, element: str) -> float:
    source = normalize(ocr_text)
    target = normalize(element)
    if not source or not target:
        return 0.0
    if source == target:
        return 1.0
    if len(target) >= 4 and (target in source or source in target):
        shorter, longer = sorted((len(source), len(target)))
        return 0.84 + 0.16 * (shorter / longer)
    return SequenceMatcher(None, source, target).ratio()


def recognize_elements(image_bytes: bytes) -> dict[str, Any]:
    image = prepare_image(image_bytes)
    result = OCR_ENGINE(image, text_score=0.18, box_thresh=0.24)
    texts = list(result.txts or ())
    scores = list(result.scores or ())

    raw = [
        {"text": text, "confidence": round(float(score), 3)}
        for text, score in zip(texts, scores)
        if normalize(text)
    ]
    matched: dict[str, dict[str, Any]] = {}

    for item in raw:
        text = item["text"]
        ranked = sorted(
            ((similarity(text, element), element) for element in ELEMENTS),
            reverse=True,
        )
        match_score, name = ranked[0]
        threshold = 0.7 if len(normalize(name)) <= 4 else 0.58
        if match_score < threshold:
            continue

        confidence = round(0.55 * item["confidence"] + 0.45 * match_score, 3)
        key = normalize(name)
        if key not in matched or confidence > matched[key]["confidence"]:
            matched[key] = {
                "name": name,
                "confidence": confidence,
                "recognizedAs": text,
            }

    return {
        "elements": sorted(matched.values(), key=lambda item: item["name"]),
        "raw": raw,
        "engine": "RapidOCR · PP-OCRv5 Cyrillic",
    }


class handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                self._json(413, {"error": "Скриншот слишком большой"})
                return

            payload = json.loads(self.rfile.read(content_length))
            encoded = payload.get("image", "")
            if not isinstance(encoded, str) or not encoded:
                self._json(400, {"error": "Изображение не передано"})
                return

            if "," in encoded:
                encoded = encoded.split(",", 1)[1]
            image_bytes = base64.b64decode(encoded, validate=True)
            if len(image_bytes) > MAX_IMAGE_BYTES:
                self._json(413, {"error": "Скриншот слишком большой"})
                return

            self._json(200, recognize_elements(image_bytes))
        except (ValueError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)})
        except Exception:
            self._json(500, {"error": "Не удалось распознать скриншот"})

    def do_GET(self) -> None:
        self._json(200, {"status": "ok", "engine": "RapidOCR"})
