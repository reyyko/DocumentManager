#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
from typing import Any

from paddleocr import PaddleOCR


def extract_payload(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        payload = result.get("res", result)
        return payload if isinstance(payload, dict) else {"value": payload}

    if hasattr(result, "res"):
        payload = getattr(result, "res")
        if isinstance(payload, dict):
            return payload
        return {"value": payload}

    if hasattr(result, "json"):
        raw = getattr(result, "json")
        if isinstance(raw, dict):
            payload = raw.get("res", raw)
            return payload if isinstance(payload, dict) else {"value": payload}
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                payload = parsed.get("res", parsed)
                return payload if isinstance(payload, dict) else {"value": payload}
            except json.JSONDecodeError:
                return {"value": raw}

    if hasattr(result, "__dict__"):
        data = getattr(result, "__dict__")
        payload = data.get("res", data)
        return payload if isinstance(payload, dict) else {"value": payload}

    return {"value": str(result)}


def collect_text(payload: dict[str, Any]) -> tuple[list[str], list[float]]:
    texts: list[str] = []
    scores: list[float] = []

    rec_texts = payload.get("rec_texts")
    if isinstance(rec_texts, list):
        texts.extend(str(item).strip() for item in rec_texts if str(item).strip())

    rec_text = payload.get("rec_text")
    if isinstance(rec_text, str) and rec_text.strip():
        texts.append(rec_text.strip())

    rec_scores = payload.get("rec_scores")
    if isinstance(rec_scores, list):
        for score in rec_scores:
            try:
                scores.append(float(score))
            except (TypeError, ValueError):
                continue

    rec_score = payload.get("rec_score")
    if rec_score is not None:
        try:
            scores.append(float(rec_score))
        except (TypeError, ValueError):
            pass

    return texts, scores


def main() -> int:
    parser = argparse.ArgumentParser(description="Run PaddleOCR on one or more image files")
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("--lang", default="fr")
    args = parser.parse_args()

    input_paths = [Path(value).resolve() for value in args.inputs]
    missing = [str(path) for path in input_paths if not path.exists()]
    if missing:
        print(json.dumps({"error": "missing input files", "paths": missing}, ensure_ascii=False))
        return 1

    ocr = PaddleOCR(
        lang=args.lang,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )

    outputs = []
    full_text_parts: list[str] = []
    score_accumulator: list[float] = []

    for path in input_paths:
        page_results = list(ocr.predict(str(path)))
        page_texts: list[str] = []
        page_scores: list[float] = []
        raw_outputs: list[dict[str, Any]] = []

        for result in page_results:
            payload = extract_payload(result)
            texts, scores = collect_text(payload)
            page_texts.extend(texts)
            page_scores.extend(scores)
            raw_outputs.append(payload)

        page_text = "\n".join(page_texts).strip()
        if page_text:
            full_text_parts.append(page_text)
        score_accumulator.extend(page_scores)

        outputs.append(
            {
                "input": str(path),
                "text": page_text,
                "text_length": len(page_text),
                "mean_score": (sum(page_scores) / len(page_scores)) if page_scores else None,
                "result_count": len(raw_outputs),
            }
        )

    print(
        json.dumps(
            {
                "inputs": outputs,
                "full_text": "\n\n".join(part for part in full_text_parts if part).strip(),
                "mean_score": (sum(score_accumulator) / len(score_accumulator)) if score_accumulator else None,
                "lang": args.lang,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
