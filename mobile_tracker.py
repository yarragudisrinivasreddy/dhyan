"""
Dhyan — mobile_tracker.py
Tracks mobile phone usage patterns during work sessions.
Helps Gemma provide context-aware advice about dual-screen fatigue.
All data in-memory only.
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict

logger = logging.getLogger(__name__)


class MobileTracker:
    """Tracks phone pickup/putdown events to assess dual-screen fatigue."""

    def __init__(self):
        self._events: List[Dict] = []
        self._enabled: bool = False

    def enable(self) -> None:
        self._enabled = True
        logger.info("Mobile awareness enabled.")

    def disable(self) -> None:
        self._enabled = False

    def log_event(self, event_type: str) -> None:
        if not self._enabled:
            return
        self._events.append({
            "type": event_type,
            "timestamp": datetime.now().isoformat()
        })

    def get_count(self) -> int:
        return len([e for e in self._events if e["type"] == "pickup"])

    def is_high_usage(self) -> bool:
        """More than 6 pickups in last 30 min = high mobile distraction."""
        cutoff = datetime.now() - timedelta(minutes=30)
        recent = [
            e for e in self._events
            if e["type"] == "pickup"
            and datetime.fromisoformat(e["timestamp"]) > cutoff
        ]
        return len(recent) > 6

    def get_summary(self) -> Dict:
        pickups = self.get_count()
        return {
            "enabled": self._enabled,
            "total_pickups": pickups,
            "high_usage": self.is_high_usage(),
            "distraction_level": "high" if pickups > 10 else "medium" if pickups > 4 else "low"
        }

    def clear(self) -> None:
        self._events = []


mobile_tracker = MobileTracker()
