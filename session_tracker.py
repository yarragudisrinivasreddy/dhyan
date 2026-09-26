"""
session_tracker.py — In-memory session store for Dhyan.
Tracks analysis history and mood trends for the current session.
Privacy: Nothing is written to disk.
"""

import logging
from datetime import datetime
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class SessionTracker:
    """Tracks a single user session — all data in-memory only."""

    def __init__(self):
        self._history: List[Dict[str, Any]] = []
        self._session_start = datetime.now()

    def record(self, analysis: Dict[str, Any]) -> None:
        """Store a Gemma analysis result with a timestamp."""
        entry = {
            "timestamp": datetime.now().isoformat(),
            "fatigue_level": analysis.get("fatigue_level", "unknown"),
            "posture_score": analysis.get("posture_score", 5),
            "tips": analysis.get("tips", []),
            "break_suggestion": analysis.get("break_suggestion", ""),
            "affirmation": analysis.get("affirmation", ""),
            "observations": analysis.get("observations", []),
        }
        self._history.append(entry)
        logger.info("Session entry recorded. Total checks: %d", len(self._history))

    def get_stats(self) -> Dict[str, Any]:
        """Compute session-level stats for the dashboard."""
        if not self._history:
            return {
                "total_checks": 0,
                "avg_posture_score": None,
                "fatigue_distribution": {},
                "session_duration_minutes": 0,
                "history": []
            }

        total = len(self._history)
        avg_posture = sum(e["posture_score"] for e in self._history) / total

        fatigue_counts = {"low": 0, "medium": 0, "high": 0}
        for entry in self._history:
            level = entry["fatigue_level"]
            if level in fatigue_counts:
                fatigue_counts[level] += 1

        duration = (datetime.now() - self._session_start).seconds // 60

        return {
            "total_checks": total,
            "avg_posture_score": round(avg_posture, 1),
            "fatigue_distribution": fatigue_counts,
            "session_duration_minutes": duration,
            "history": self._history
        }

    def clear(self) -> None:
        """Reset session data."""
        self._history = []
        self._session_start = datetime.now()
        logger.info("Session cleared.")


# Singleton tracker for the Flask session
tracker = SessionTracker()
