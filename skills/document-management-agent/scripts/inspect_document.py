#!/usr/bin/env python3
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

PDF_TEXT_MARKERS = [b"BT", b"TJ", b"Tj", b"/Font", b"/ToUnicode"]
TEXT_EXTS = {".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".html", ".log"}


def safe_read_bytes(path: Path, limit: int | None = None) -> bytes:
    with path.open("rb") as file_handle:
        return file_handle.read() if limit is None else file_handle.read(limit)


def snippet(text: str, limit: int = 4000) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def looks_text(data: bytes) -> bool:
    if not data:
        return True
    sample = data[:4096]
    if b"\x00" in sample:
        return False
    printable = sum(1 for byte in sample if 9 <= byte <= 13 or 32 <= byte <= 126)
    return printable / max(1, len(sample)) > 0.8


def inspect_pdf(path: Path) -> dict:
    data = safe_read_bytes(path)
    page_count = len(re.findall(br"/Type\s*/Page\b", data))
    image_count = len(re.findall(br"/Subtype\s*/Image\b", data))
    text_marker_hits = sum(data.count(marker) for marker in PDF_TEXT_MARKERS)
    producer = None
    producer_match = re.search(br"/Producer\s*\((.*?)\)", data, re.S)
    if producer_match:
        producer = producer_match.group(1).decode("latin1", errors="replace")
    title = None
    title_match = re.search(br"/Title\s*\((.*?)\)", data, re.S)
    if title_match:
        title = title_match.group(1).decode("latin1", errors="replace")

    likely_scan = image_count >= max(1, page_count) and text_marker_hits < max(3, page_count)
    extractable_text = ""
    ascii_candidates = re.findall(rb"\(([ -~]{20,})\)", data)
    if ascii_candidates:
        joined = " ".join(candidate.decode("latin1", errors="replace") for candidate in ascii_candidates[:50])
        extractable_text = snippet(joined)

    return {
        "type": "pdf",
        "pages": page_count,
        "images": image_count,
        "text_marker_hits": text_marker_hits,
        "likely_scan_only": likely_scan,
        "producer": producer,
        "title": title,
        "text_excerpt": extractable_text,
        "analysis_notes": [
            "heuristic only",
            "direct OCR not performed",
        ],
    }


def extract_docx_text(zip_file: zipfile.ZipFile) -> str:
    try:
        data = zip_file.read("word/document.xml")
    except KeyError:
        return ""
    root = ET.fromstring(data)
    texts = []
    for elem in root.iter():
        if elem.tag.endswith("}t") and elem.text:
            texts.append(elem.text)
        elif elem.tag.endswith("}tab"):
            texts.append("\t")
        elif elem.tag.endswith("}br") or elem.tag.endswith("}cr"):
            texts.append("\n")
        elif elem.tag.endswith("}p"):
            texts.append("\n")
    return snippet("".join(texts), 12000)


def extract_docx_meta(zip_file: zipfile.ZipFile) -> dict:
    meta = {}
    for member, keymap in [
        (
            "docProps/core.xml",
            {
                "title": "title",
                "subject": "subject",
                "creator": "creator",
                "description": "description",
                "created": "created",
                "modified": "modified",
            },
        ),
        (
            "docProps/app.xml",
            {
                "Application": "application",
                "Pages": "pages",
                "Words": "words",
                "Characters": "characters",
                "Company": "company",
            },
        ),
    ]:
        try:
            root = ET.fromstring(zip_file.read(member))
        except Exception:
            continue
        for elem in root.iter():
            local = elem.tag.split("}")[-1]
            if local in keymap and elem.text:
                meta[keymap[local]] = elem.text
    return meta


def inspect_docx(path: Path) -> dict:
    with zipfile.ZipFile(path) as zip_file:
        names = zip_file.namelist()
        return {
            "type": "docx",
            "member_count": len(names),
            "metadata": extract_docx_meta(zip_file),
            "text_excerpt": extract_docx_text(zip_file),
            "has_comments": any(name.startswith("word/comments") for name in names),
            "has_footnotes": any(name.startswith("word/footnotes") for name in names),
            "has_headers": any(name.startswith("word/header") for name in names),
            "has_tables_possible": True,
            "analysis_notes": [
                "lightweight OOXML extraction",
                "layout and complex tables may be simplified",
            ],
        }


def inspect_zip(path: Path) -> dict:
    with zipfile.ZipFile(path) as zip_file:
        members = []
        for info in zip_file.infolist()[:200]:
            members.append(
                {
                    "name": info.filename,
                    "size": info.file_size,
                    "compressed_size": info.compress_size,
                    "is_dir": info.is_dir(),
                }
            )
        extension_summary = {}
        for member in members:
            extension = Path(member["name"]).suffix.lower() or "[no extension]"
            extension_summary[extension] = extension_summary.get(extension, 0) + 1
        return {
            "type": "zip",
            "member_count": len(zip_file.infolist()),
            "members_preview": members,
            "extension_summary": dict(sorted(extension_summary.items(), key=lambda item: (-item[1], item[0]))),
            "analysis_notes": [
                "archive contents listed",
                "nested files not deeply parsed by default",
            ],
        }


def inspect_textlike(path: Path) -> dict:
    data = safe_read_bytes(path, 12000)
    return {
        "type": "text-like",
        "text_excerpt": snippet(data.decode("utf-8", errors="replace"), 8000),
    }


def inspect_generic(path: Path) -> dict:
    data = safe_read_bytes(path, 4096)
    return {
        "type": "unknown",
        "looks_text": looks_text(data),
        "header_hex": data[:64].hex(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect document-like files for analysis workflows")
    parser.add_argument("path")
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(json.dumps({"error": "file not found", "path": str(path)}))
        return 1

    result = {
        "path": str(path),
        "name": path.name,
        "size": path.stat().st_size,
        "suffix": path.suffix.lower(),
    }

    try:
        if path.suffix.lower() == ".pdf":
            result["inspection"] = inspect_pdf(path)
        elif path.suffix.lower() == ".docx":
            result["inspection"] = inspect_docx(path)
        elif path.suffix.lower() == ".zip":
            result["inspection"] = inspect_zip(path)
        elif path.suffix.lower() in TEXT_EXTS:
            result["inspection"] = inspect_textlike(path)
        else:
            data = safe_read_bytes(path, 4)
            if data.startswith(b"PK\x03\x04") and path.suffix.lower() != ".zip":
                result["inspection"] = inspect_zip(path)
            elif looks_text(safe_read_bytes(path, 4096)):
                result["inspection"] = inspect_textlike(path)
            else:
                result["inspection"] = inspect_generic(path)
    except zipfile.BadZipFile:
        result["inspection"] = {"type": "invalid-zip", "error": "archive could not be opened"}
    except Exception as error:
        result["inspection"] = {"type": "error", "error": str(error)}

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
