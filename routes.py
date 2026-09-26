"""
routes.py — HTTP route handlers for Dhyan.
Separates routing from business logic.
"""

import base64
import logging
from datetime import datetime

from flask import Flask, request, jsonify, render_template

from agent import agent_state, AgentPhase, FatigueLevel, CheckResult
from config import MAX_IMAGE_BYTES, AGENT_HANDOFF_THRESHOLD
from gemma import analyze_frame, get_cached_analysis
from mobile_tracker import mobile_tracker
from presence import is_frame_valid_for_analysis
from session_tracker import tracker
from exceptions import GemmaConnectionError, GemmaResponseError, InvalidImageError

logger = logging.getLogger(__name__)


def _extract_image_b64(req) -> str:
    """Extract and validate base64 image from request JSON."""
    data = req.get_json(silent=True)
    if not data or "image" not in data:
        raise InvalidImageError("No image field in request body.")

    image_b64 = data["image"]

    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    decoded_size = len(base64.b64decode(image_b64 + "=="))
    if decoded_size > MAX_IMAGE_BYTES:
        raise InvalidImageError("Image exceeds size limit.")

    return image_b64


def _fatigue_level(value: str) -> FatigueLevel:
    try:
        return FatigueLevel(value.lower())
    except (ValueError, AttributeError):
        return FatigueLevel.UNKNOWN


def _safe_posture(value) -> int:
    try:
        return max(1, min(10, int(float(value))))
    except (TypeError, ValueError):
        return 5


def _offline_payload(exc: Exception, status_without_cache: int = 503):
    """Shared offline recovery response — prefer last good insight over hard fail."""
    agent_state.phase = AgentPhase.OFFLINE_RECOVERY
    agent_state.offline_recoveries += 1
    cached = get_cached_analysis()
    if cached:
        return jsonify({
            "success": True,
            "analysis": cached,
            "offline_recovery": True,
            "error": str(exc),
        }), 200
    return jsonify({
        "success": False,
        "error": str(exc),
        "offline_recovery": True,
    }), status_without_cache


def register_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        """Serve the main Dhyan dashboard."""
        return render_template("index.html")

    @app.route("/analyze", methods=["POST"])
    def analyze():
        """
        Receive a webcam frame, run Gemma 4 analysis, store result, return insights.

        Request body: { "image": "<base64 JPEG>", "mobile_active": bool }
        Response: { "success": true, "analysis": {...} }
        """
        try:
            data = request.get_json(silent=True) or {}
            image_b64 = _extract_image_b64(request)
            mobile_active = bool(data.get("mobile_active")) or mobile_tracker.is_high_usage()

            agent_state.phase = AgentPhase.DECIDING
            trend = agent_state.get_trend()
            analysis = analyze_frame(image_b64, trend=trend, mobile_active=mobile_active)

            result = CheckResult(
                timestamp=datetime.now().isoformat(),
                fatigue_level=_fatigue_level(str(analysis.get("fatigue_level", "unknown"))),
                posture_score=_safe_posture(analysis.get("posture_score", 5)),
                tips=list(analysis.get("tips") or []),
                break_suggestion=str(analysis.get("break_suggestion") or ""),
                affirmation=str(analysis.get("affirmation") or ""),
                observations=list(analysis.get("observations") or []),
                presence_confirmed=True,
                gemma_reachable=True,
            )
            agent_state.record(result)
            tracker.record(analysis)

            if agent_state.should_handoff(AGENT_HANDOFF_THRESHOLD):
                agent_state.handoff_triggered = True
                agent_state.phase = AgentPhase.HANDOFF
            else:
                agent_state.phase = AgentPhase.ACTING

            return jsonify({
                "success": True,
                "analysis": analysis,
                "handoff": agent_state.handoff_triggered,
                "consecutive_high_fatigue": agent_state.consecutive_high_fatigue,
            })

        except InvalidImageError as exc:
            logger.warning("Invalid image: %s", exc)
            return jsonify({"success": False, "error": str(exc)}), 400

        except GemmaConnectionError as exc:
            logger.error("Gemma connection error: %s", exc)
            return _offline_payload(exc, 503)

        except GemmaResponseError as exc:
            logger.error("Gemma parse error: %s", exc)
            return _offline_payload(exc, 500)

        except Exception as exc:
            logger.exception("Unexpected error in /analyze: %s", exc)
            return _offline_payload(
                Exception(f"Analysis failed: {exc}"),
                500,
            )

    @app.route("/stats", methods=["GET"])
    def stats():
        """Return session statistics for the dashboard."""
        base = tracker.get_stats()
        base["skipped_checks"] = agent_state.skipped_checks
        base["agent"] = {
            "phase": agent_state.phase.value,
            "trend": agent_state.get_trend(),
            "handoff_triggered": agent_state.handoff_triggered,
            "consecutive_high_fatigue": agent_state.consecutive_high_fatigue,
        }
        return jsonify(base)

    @app.route("/clear", methods=["POST"])
    def clear_session():
        """Reset the current session tracker and agent state."""
        tracker.clear()
        agent_state.clear()
        mobile_tracker.clear()
        return jsonify({"success": True, "message": "Session cleared."})

    @app.route("/health", methods=["GET"])
    def health():
        """Health check endpoint."""
        return jsonify({"status": "ok", "app": "Dhyan", "privacy": "local-only"})

    @app.route("/agent/state", methods=["GET"])
    def get_agent_state():
        """Full agent state — phase, trend, handoff status, history."""
        return jsonify(agent_state.to_dict())

    @app.route("/agent/acknowledge", methods=["POST"])
    def acknowledge():
        """
        CHECK phase: user acknowledged the wellness alert.
        Updates the last check result's acknowledged flag.
        """
        if agent_state.history:
            agent_state.history[-1].user_acknowledged = True
        agent_state.phase = AgentPhase.IDLE
        return jsonify({"success": True, "phase": "checking_complete"})

    @app.route("/agent/handoff/reset", methods=["POST"])
    def reset_handoff():
        """Human takes back control after handoff. Resets consecutive counter."""
        agent_state.consecutive_high_fatigue = 0
        agent_state.handoff_triggered = False
        agent_state.phase = AgentPhase.IDLE
        return jsonify({"success": True, "message": "Agent resumed. Take care of yourself."})

    @app.route("/presence/validate", methods=["POST"])
    def validate_presence():
        """
        Client sends frame before full analysis.
        Returns whether user appears present — saves a full Gemma call if not.
        """
        data = request.get_json(silent=True)
        if not data or "image" not in data:
            return jsonify({"present": False, "reason": "no_frame"}), 400

        image_b64 = data["image"]
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        result = is_frame_valid_for_analysis(image_b64)
        if not result["valid"]:
            agent_state.skipped_checks += 1

        return jsonify({
            "present": result["valid"],
            "reason": result["reason"],
            "brightness": result["brightness"]
        })

    @app.route("/mobile/event", methods=["POST"])
    def mobile_event():
        """
        Log a mobile phone pickup/putdown event.
        Used by the mobile awareness module.
        """
        data = request.get_json(silent=True) or {}
        if data.get("enabled") is True:
            mobile_tracker.enable()
        if data.get("enabled") is False:
            mobile_tracker.disable()

        event_type = data.get("type", "pickup")  # pickup | putdown
        if event_type in ("pickup", "putdown"):
            mobile_tracker.log_event(event_type)

        return jsonify({
            "success": True,
            "events_today": mobile_tracker.get_count(),
            "summary": mobile_tracker.get_summary(),
        })
