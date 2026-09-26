"""
gemma.py — Gemma 4 e4b integration via LM Studio's OpenAI-compatible local API.
All inference is local. No external API calls.
"""

import base64
import json
import logging
from typing import Optional

import requests

from config import (
    LMSTUDIO_URL,
    MODEL_NAME,
    GEMMA_TIMEOUT_SECONDS,
    GEMMA_MAX_TOKENS,
    GEMMA_TEMPERATURE,
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


def analyze_frame(
    image_b64: str,
    trend: str = "unknown",
    mobile_active: bool = False,
) -> dict:
    """
    Send a base64-encoded webcam frame to Gemma 4 for wellness analysis.

    Raises:
        GemmaConnectionError: If LM Studio is not running.
        GemmaResponseError: If the response cannot be parsed.
    """
    global _last_successful

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
                        "text": "Please analyze this person's wellness state and return your assessment as JSON."
                    }
                ]
            }
        ],
        "temperature": GEMMA_TEMPERATURE,
        "max_tokens": GEMMA_MAX_TOKENS,
    }

    try:
        response = _session.post(LMSTUDIO_URL, json=payload, timeout=GEMMA_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.exceptions.ConnectionError as exc:
        logger.error("Cannot connect to LM Studio at %s", LMSTUDIO_URL)
        raise GemmaConnectionError(
            "LM Studio is not running. Please start it with Gemma 4 e4b loaded."
        ) from exc
    except requests.exceptions.RequestException as exc:
        logger.error("LM Studio request failed: %s", exc)
        detail = ""
        if getattr(exc, "response", None) is not None:
            try:
                detail = exc.response.text[:300]
            except Exception:
                detail = str(exc.response.status_code)
        raise GemmaConnectionError(
            f"LM Studio error: {exc}" + (f" — {detail}" if detail else "")
        ) from exc
    raw = response.json()

    try:
        content = raw["choices"][0]["message"]["content"].strip()
        result = _normalize_analysis(_extract_json(content))
        _last_successful = result
        logger.info("Gemma analysis complete — fatigue: %s", result.get("fatigue_level"))
        return result
    except (KeyError, ValueError, IndexError, json.JSONDecodeError) as exc:
        logger.error("Failed to parse Gemma response: %s", raw)
        raise GemmaResponseError(f"Could not parse Gemma response: {exc}") from exc