"""
gemma.py — Gemma 4 e4b integration via LM Studio's OpenAI-compatible local API.
All inference is local. No external API calls.
"""

import base64
import json
import logging
import time
from typing import Optional

import requests

from config import (
    LMSTUDIO_URL,
    MODEL_NAME,
    GEMMA_TIMEOUT_SECONDS,
    GEMMA_MAX_TOKENS,
    GEMMA_TEMPERATURE,
    GEMMA_MAX_RETRIES,
)
from exceptions import GemmaConnectionError, GemmaResponseError

logger = logging.getLogger(__name__)

_session = requests.Session()
_session.headers.update({"Connection": "keep-alive"})

_last_successful: Optional[dict] = None


def _extract_json(content: str) -> dict:
    """Parse model output that may include markdown fences or trailing text."""
    text = content.strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _normalize_analysis(result: dict) -> dict:
    """Coerce Gemma output into the shape the UI expects."""
    level = str(result.get("fatigue_level", "medium")).lower()
    if "high" in level:
        level = "high"
    elif "low" in level:
        level = "low"
    elif "medium" in level or "med" in level:
        level = "medium"
    else:
        level = "medium"

    try:
        score = int(float(result.get("posture_score", 5)))
    except (TypeError, ValueError):
        score = 5
    score = max(1, min(10, score))

    tips = result.get("tips") or []
    if isinstance(tips, str):
        tips = [tips]
    observations = result.get("observations") or []
    if isinstance(observations, str):
        observations = [observations]

    return {
        "fatigue_level": level,
        "posture_score": score,
        "observations": list(observations)[:5],
        "tips": list(tips)[:5] or ["Take a short screen break.", "Stretch your neck.", "Hydrate."],
        "break_suggestion": str(result.get("break_suggestion") or "Stand and stretch for 5 minutes."),
        "affirmation": str(result.get("affirmation") or "You're taking care of yourself."),
        "urgency": str(result.get("urgency") or "routine"),
        "agent_recommendation": str(result.get("agent_recommendation") or "continue"),
    }


def build_system_prompt(trend: str = "unknown", mobile_active: bool = False) -> str:
    mobile_note = ""
    if mobile_active:
        mobile_note = """
The user has been using their mobile phone during this work session.
Consider eye strain from switching between screens and neck strain
from looking down at the phone. Add specific tips about dual-screen fatigue."""

    return f"""You are Dhyan, a privacy-first AI wellness agent running 100% locally on Gemma 4.
You protect the user's mental and physical health during long screen sessions.

Recent fatigue trend: {trend}
{mobile_note}

Your role in the agent loop:
- SENSE phase has already captured the user's webcam frame
- You are in DECIDE phase — analyze and return structured decision
- The system will handle ACT (notifications, sounds) and CHECK (acknowledgment)

Analyze the image for: posture alignment, eye fatigue, facial tension, shoulder position.

Return ONLY valid JSON, no markdown, no preamble:
{{
  "fatigue_level": "low|medium|high",
  "posture_score": 1-10,
  "observations": ["observation 1", "observation 2"],
  "tips": ["specific tip 1", "specific tip 2", "specific tip 3"],
  "break_suggestion": "specific 5-min activity",
  "affirmation": "one warm positive message",
  "urgency": "routine|elevated|urgent",
  "agent_recommendation": "continue|extend_break|handoff"
}}

Privacy guarantee: This runs 100% locally. Zero data leaves this device."""


def get_cached_analysis() -> Optional[dict]:
    """Return last successful analysis for offline recovery, if any."""
    return _last_successful


def _ensure_jpeg_b64(image_b64: str) -> str:
    """Strip data-URL prefix and verify JPEG magic bytes."""
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(image_b64 + "==", validate=False)
    except Exception as exc:
        raise GemmaConnectionError(f"Invalid frame encoding: {exc}") from exc
    if len(raw) < 100 or raw[:2] != b"\xff\xd8":
        raise GemmaConnectionError("Captured frame is not a valid JPEG — retrying capture.")
    return image_b64


def _post_once(payload: dict) -> dict:
    try:
        response = _session.post(
            LMSTUDIO_URL, json=payload, timeout=GEMMA_TIMEOUT_SECONDS
        )
    except requests.exceptions.Timeout as exc:
        raise GemmaConnectionError(
            f"Gemma timed out after {GEMMA_TIMEOUT_SECONDS}s — model may be busy."
        ) from exc
    except requests.exceptions.ConnectionError as exc:
        raise GemmaConnectionError(
            "LM Studio is not running. Start it with Gemma 4 e4b loaded on port 1234."
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise GemmaConnectionError(f"LM Studio request failed: {exc}") from exc

    if response.status_code >= 500:
        raise GemmaConnectionError(
            f"LM Studio server error {response.status_code}: {response.text[:200]}"
        )

    if response.status_code >= 400:
        detail = response.text[:300]
        # Transient busy / invalid frame — let caller retry
        raise GemmaConnectionError(
            f"LM Studio rejected request ({response.status_code}): {detail}"
        )

    try:
        return response.json()
    except ValueError as exc:
        raise GemmaConnectionError(
            f"LM Studio returned non-JSON body: {response.text[:200]}"
        ) from exc


def analyze_frame(
    image_b64: str,
    trend: str = "unknown",
    mobile_active: bool = False,
) -> dict:
    """
    Send a base64-encoded webcam frame to Gemma 4 for wellness analysis.

    Raises:
        GemmaConnectionError: If LM Studio is not running / times out.
        GemmaResponseError: If the response cannot be parsed.
    """
    global _last_successful

    image_b64 = _ensure_jpeg_b64(image_b64)

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": build_system_prompt(trend, mobile_active)},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}"
                        }
                    },
                    {
                        "type": "text",
                        "text": (
                            "Analyze this webcam frame. Reply with ONLY the JSON object "
                            "described in the system prompt — no markdown fences."
                        ),
                    }
                ]
            }
        ],
        "temperature": GEMMA_TEMPERATURE,
        "max_tokens": GEMMA_MAX_TOKENS,
    }

    last_err: Optional[Exception] = None
    for attempt in range(1, GEMMA_MAX_RETRIES + 1):
        try:
            raw = _post_once(payload)
            content = (raw.get("choices") or [{}])[0].get("message", {}).get("content")
            if not content or not str(content).strip():
                raise GemmaResponseError("Empty response from Gemma.")
            result = _normalize_analysis(_extract_json(str(content).strip()))
            _last_successful = result
            logger.info(
                "Gemma analysis complete — fatigue: %s (attempt %d)",
                result.get("fatigue_level"),
                attempt,
            )
            return result
        except GemmaResponseError as exc:
            last_err = exc
            logger.warning("Gemma parse issue on attempt %d/%d: %s", attempt, GEMMA_MAX_RETRIES, exc)
            if attempt < GEMMA_MAX_RETRIES:
                time.sleep(0.6 * attempt)
                continue
            raise
        except GemmaConnectionError as exc:
            last_err = exc
            logger.warning("Gemma connection issue on attempt %d/%d: %s", attempt, GEMMA_MAX_RETRIES, exc)
            if attempt < GEMMA_MAX_RETRIES:
                time.sleep(0.8 * attempt)
                continue
            raise

    raise GemmaConnectionError(str(last_err) if last_err else "Gemma unavailable")
