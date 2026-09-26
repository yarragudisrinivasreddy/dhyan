"""
Dhyan — presence.py
Server-side frame gate before Gemma analysis.
Client-side presence.js does pixel brightness/motion; this validates payload size.
"""

import base64
import logging

logger = logging.getLogger(__name__)

# Truly empty/corrupt payloads
MIN_FRAME_KB = 2.0
# Dark/blank scenes compress very small at 480x360
DARK_FRAME_KB = 8.0
MAX_FRAME_KB = 3000.0


def is_frame_valid_for_analysis(frame_b64: str, prev_frame_b64: str | None = None) -> dict:
    """
    Server-side validation of whether a frame is worth sending to Gemma.
    Returns dict with: valid (bool), reason (str), brightness (float)
    """
    try:
        frame_bytes = base64.b64decode(frame_b64 + "==")
        size_kb = len(frame_bytes) / 1024

        if size_kb < MIN_FRAME_KB:
            return {"valid": False, "reason": "frame_too_small", "brightness": 0}

        if size_kb > MAX_FRAME_KB:
            return {"valid": False, "reason": "frame_too_large", "brightness": 0}

        # Dark/empty frames compress under ~8KB; normal webcam frames are larger.
        if size_kb < DARK_FRAME_KB:
            return {
                "valid": False,
                "reason": "frame_too_dark_user_absent",
                "brightness": size_kb,
            }

        estimated_brightness = min(100.0, size_kb * 2.5)
        return {"valid": True, "reason": "ok", "brightness": estimated_brightness}

    except Exception as exc:
        logger.warning("Frame validation error: %s", exc)
        return {"valid": False, "reason": "validation_error", "brightness": 0}
