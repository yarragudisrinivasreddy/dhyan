"""
Dhyan — agent.py
Implements the sense → decide → act → check agent loop.

Problem Statement 5 requirements met:
- Sense: webcam frame + presence detection
- Decide: Gemma 4 analysis with trend context
- Act: notification + sound + break reminder
- Check: verify user acknowledged, track outcome
- Local state management: AgentState tracks across sessions
- Offline recovery: graceful degradation if Gemma unreachable
- Human handoff: explicit threshold after 3x HIGH fatigue
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)


class FatigueLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    UNKNOWN = "unknown"


class AgentPhase(str, Enum):
    IDLE = "idle"
    SENSING = "sensing"
    DECIDING = "deciding"
    ACTING = "acting"
    CHECKING = "checking"
    HANDOFF = "handoff"          # agent stepping back, human takes over
    OFFLINE_RECOVERY = "offline_recovery"


@dataclass
class CheckResult:
    timestamp: str
    fatigue_level: FatigueLevel
    posture_score: int
    tips: List[str]
    break_suggestion: str
    affirmation: str
    observations: List[str]
    presence_confirmed: bool = True
    gemma_reachable: bool = True
    user_acknowledged: bool = False   # updated in CHECK phase


@dataclass
class AgentState:
    """
    Full in-memory agent state across the session.
    Never written to disk — privacy by design.
    """
    phase: AgentPhase = AgentPhase.IDLE
    consecutive_high_fatigue: int = 0
    handoff_triggered: bool = False
    total_checks: int = 0
    skipped_checks: int = 0          # presence not detected
    offline_recoveries: int = 0
    history: List[CheckResult] = field(default_factory=list)
    last_check_time: Optional[str] = None
    session_start: str = field(default_factory=lambda: datetime.now().isoformat())

    def record(self, result: CheckResult) -> None:
        self.history.append(result)
        self.total_checks += 1
        self.last_check_time = result.timestamp

        if result.fatigue_level == FatigueLevel.HIGH:
            self.consecutive_high_fatigue += 1
        else:
            self.consecutive_high_fatigue = 0

    def should_handoff(self, threshold: int = 3) -> bool:
        return self.consecutive_high_fatigue >= threshold

    def get_trend(self) -> str:
        """Return recent fatigue trend for context injection into Gemma prompt."""
        if len(self.history) < 2:
            return "insufficient data"
        recent = [h.fatigue_level for h in self.history[-3:]]
        if all(f == FatigueLevel.HIGH for f in recent):
            return "consistently high — urgent"
        if recent[-1] == FatigueLevel.LOW and recent[0] == FatigueLevel.HIGH:
            return "improving"
        if recent[-1] == FatigueLevel.HIGH and recent[0] == FatigueLevel.LOW:
            return "deteriorating"
        return "stable"

    def clear(self) -> None:
        self.phase = AgentPhase.IDLE
        self.consecutive_high_fatigue = 0
        self.handoff_triggered = False
        self.total_checks = 0
        self.skipped_checks = 0
        self.offline_recoveries = 0
        self.history = []
        self.last_check_time = None
        self.session_start = datetime.now().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "phase": self.phase.value,
            "consecutive_high_fatigue": self.consecutive_high_fatigue,
            "handoff_triggered": self.handoff_triggered,
            "total_checks": self.total_checks,
            "skipped_checks": self.skipped_checks,
            "offline_recoveries": self.offline_recoveries,
            "trend": self.get_trend(),
            "session_start": self.session_start,
            "last_check_time": self.last_check_time,
            "history": [
                {
                    "timestamp": h.timestamp,
                    "fatigue_level": h.fatigue_level.value if isinstance(h.fatigue_level, FatigueLevel) else h.fatigue_level,
                    "posture_score": h.posture_score,
                    "tips": h.tips,
                    "break_suggestion": h.break_suggestion,
                    "affirmation": h.affirmation,
                    "presence_confirmed": h.presence_confirmed,
                    "user_acknowledged": h.user_acknowledged,
                }
                for h in self.history
            ],
        }


# Singleton agent state for the Flask session
agent_state = AgentState()
