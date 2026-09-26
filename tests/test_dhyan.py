"""
tests/test_dhyan.py — Unit tests for Dhyan.
Run: pytest tests/ -v
"""

import base64
import sys
import os
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from exceptions import GemmaConnectionError, GemmaResponseError, InvalidImageError
from session_tracker import SessionTracker
from agent import AgentState, CheckResult, FatigueLevel, agent_state
from mobile_tracker import MobileTracker, mobile_tracker
from presence import is_frame_valid_for_analysis
from config import AGENT_HANDOFF_THRESHOLD


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_singletons():
    agent_state.clear()
    mobile_tracker.clear()
    mobile_tracker.disable()
    yield
    agent_state.clear()
    mobile_tracker.clear()
    mobile_tracker.disable()


@pytest.fixture
def app():
    from app import create_app
    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def sample_analysis():
    return {
        "fatigue_level": "medium",
        "posture_score": 7,
        "observations": ["Slight forward lean detected", "Eyes appear mildly tired"],
        "tips": ["Adjust monitor height", "Try the 20-20-20 rule", "Hydrate"],
        "break_suggestion": "Stand up and stretch your neck for 5 minutes",
        "affirmation": "You are making great progress today!",
        "urgency": "routine",
        "agent_recommendation": "continue",
    }


@pytest.fixture
def valid_b64_image():
    # >= ~50KB so estimated brightness (size_kb/2) clears PRESENCE_DARK_THRESHOLD (20)
    tiny_jpeg_header = (
        b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
        b'\xff\xdb\x00C\x00' + bytes([16] * 64) +
        b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00'
        b'\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00'
        b'\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b'
        b'\xff\xda\x00\x08\x01\x01\x00\x00?\x00'
    )
    padding = bytes([120] * 52000)
    return base64.b64encode(tiny_jpeg_header + padding + b'\xff\xd9').decode()


@pytest.fixture
def dark_b64_image():
    # Between 5KB and 40KB → not "too_small", but brightness = size_kb/2 < 20
    payload = b'\xff\xd8\xff\xd9' + b'\x00' * 8000
    return base64.b64encode(payload).decode()

def _make_check(level: FatigueLevel) -> CheckResult:
    return CheckResult(
        timestamp=datetime.now().isoformat(),
        fatigue_level=level,
        posture_score=5,
        tips=["tip"],
        break_suggestion="break",
        affirmation="ok",
        observations=["obs"],
    )


# ─── Health / index ───────────────────────────────────────────────────────────

def test_health_returns_ok(client):
    res = client.get('/health')
    assert res.status_code == 200
    data = res.get_json()
    assert data['status'] == 'ok'
    assert data['app'] == 'Dhyan'
    assert data['privacy'] == 'local-only'


def test_index_returns_200(client):
    res = client.get('/')
    assert res.status_code == 200
    assert b'Dhyan' in res.data


def test_stats_empty_session(client):
    client.post('/clear')
    res = client.get('/stats')
    data = res.get_json()
    assert data['total_checks'] == 0
    assert data['avg_posture_score'] is None


def test_clear_session(client):
    res = client.post('/clear')
    assert res.status_code == 200
    assert res.get_json()['success'] is True


# ─── Analyze ──────────────────────────────────────────────────────────────────

def test_analyze_missing_image(client):
    res = client.post('/analyze', json={}, content_type='application/json')
    assert res.status_code == 400
    assert res.get_json()['success'] is False


def test_analyze_success(client, valid_b64_image, sample_analysis):
    with patch('routes.analyze_frame', return_value=sample_analysis):
        res = client.post('/analyze', json={'image': valid_b64_image})
        assert res.status_code == 200
        data = res.get_json()
        assert data['success'] is True
        assert data['analysis']['fatigue_level'] == 'medium'


def test_analyze_gemma_connection_error(client, valid_b64_image):
    with patch('routes.analyze_frame', side_effect=GemmaConnectionError("LM Studio not running")):
        with patch('routes.get_cached_analysis', return_value=None):
            res = client.post('/analyze', json={'image': valid_b64_image})
            assert res.status_code == 503
            assert res.get_json()['success'] is False


def test_analyze_gemma_response_error(client, valid_b64_image):
    with patch('routes.analyze_frame', side_effect=GemmaResponseError("Bad JSON")):
        res = client.post('/analyze', json={'image': valid_b64_image})
        assert res.status_code == 500


# ─── SessionTracker ──────────────────────────────────────────────────────────

def test_session_tracker_records_entry(sample_analysis):
    tracker = SessionTracker()
    tracker.record(sample_analysis)
    stats = tracker.get_stats()
    assert stats['total_checks'] == 1
    assert stats['avg_posture_score'] == 7.0


def test_session_tracker_clear(sample_analysis):
    tracker = SessionTracker()
    tracker.record(sample_analysis)
    tracker.clear()
    assert tracker.get_stats()['total_checks'] == 0


def test_custom_exceptions_are_exception_subclasses():
    assert issubclass(GemmaConnectionError, Exception)
    assert issubclass(GemmaResponseError, Exception)
    assert issubclass(InvalidImageError, Exception)


# ─── Required: presence skips dark frame ──────────────────────────────────────

def test_presence_skips_dark_frame(dark_b64_image, client):
    result = is_frame_valid_for_analysis(dark_b64_image)
    assert result["valid"] is False
    assert result["reason"] == "frame_too_dark_user_absent"

    res = client.post('/presence/validate', json={'image': dark_b64_image})
    assert res.status_code == 200
    data = res.get_json()
    assert data['present'] is False
    assert data['reason'] == 'frame_too_dark_user_absent'
    assert agent_state.skipped_checks >= 1


# ─── Required: handoff at exactly 3 consecutive HIGH ─────────────────────────

def test_agent_state_should_handoff_triggers_at_exactly_3_consecutive_HIGH():
    state = AgentState()
    assert state.should_handoff(AGENT_HANDOFF_THRESHOLD) is False

    state.record(_make_check(FatigueLevel.HIGH))
    assert state.consecutive_high_fatigue == 1
    assert state.should_handoff(AGENT_HANDOFF_THRESHOLD) is False

    state.record(_make_check(FatigueLevel.HIGH))
    assert state.consecutive_high_fatigue == 2
    assert state.should_handoff(AGENT_HANDOFF_THRESHOLD) is False

    state.record(_make_check(FatigueLevel.HIGH))
    assert state.consecutive_high_fatigue == 3
    assert state.should_handoff(AGENT_HANDOFF_THRESHOLD) is True

    # Interrupted streak resets
    state2 = AgentState()
    state2.record(_make_check(FatigueLevel.HIGH))
    state2.record(_make_check(FatigueLevel.HIGH))
    state2.record(_make_check(FatigueLevel.LOW))
    assert state2.consecutive_high_fatigue == 0
    assert state2.should_handoff(AGENT_HANDOFF_THRESHOLD) is False


# ─── Required: offline recovery when Gemma unreachable ────────────────────────

def test_offline_recovery_path_when_gemma_unreachable(client, valid_b64_image, sample_analysis):
    with patch('routes.analyze_frame', side_effect=GemmaConnectionError("down")):
        with patch('routes.get_cached_analysis', return_value=sample_analysis):
            res = client.post('/analyze', json={'image': valid_b64_image})
            assert res.status_code == 200
            data = res.get_json()
            assert data['success'] is True
            assert data.get('offline_recovery') is True
            assert data['analysis']['fatigue_level'] == 'medium'
            assert agent_state.offline_recoveries >= 1
            assert agent_state.phase.value == 'offline_recovery'


# ─── Required: mobile_tracker high usage threshold ────────────────────────────

def test_mobile_tracker_is_high_usage_threshold():
    tracker = MobileTracker()
    tracker.enable()
    assert tracker.is_high_usage() is False

    # 6 pickups — still below threshold (>6 required)
    for _ in range(6):
        tracker.log_event('pickup')
    assert tracker.is_high_usage() is False

    tracker.log_event('pickup')  # 7th
    assert tracker.is_high_usage() is True

    # Old events outside 30-min window should not count
    tracker2 = MobileTracker()
    tracker2.enable()
    old_ts = (datetime.now() - timedelta(minutes=45)).isoformat()
    for _ in range(10):
        tracker2._events.append({"type": "pickup", "timestamp": old_ts})
    assert tracker2.is_high_usage() is False


# ─── Required: /agent/acknowledge updates flag ────────────────────────────────

def test_agent_acknowledge_updates_user_acknowledged_flag(client, valid_b64_image, sample_analysis):
    with patch('routes.analyze_frame', return_value=sample_analysis):
        client.post('/analyze', json={'image': valid_b64_image})

    assert agent_state.history
    assert agent_state.history[-1].user_acknowledged is False

    res = client.post('/agent/acknowledge')
    assert res.status_code == 200
    data = res.get_json()
    assert data['success'] is True
    assert data['phase'] == 'checking_complete'
    assert agent_state.history[-1].user_acknowledged is True


# ─── Extra agent / presence endpoints ─────────────────────────────────────────

def test_agent_state_endpoint(client):
    res = client.get('/agent/state')
    assert res.status_code == 200
    data = res.get_json()
    assert 'phase' in data
    assert 'trend' in data


def test_presence_valid_frame(client, valid_b64_image):
    res = client.post('/presence/validate', json={'image': f'data:image/jpeg;base64,{valid_b64_image}'})
    assert res.status_code == 200
    assert res.get_json()['present'] is True


def test_handoff_reset(client):
    agent_state.consecutive_high_fatigue = 3
    agent_state.handoff_triggered = True
    res = client.post('/agent/handoff/reset')
    assert res.status_code == 200
    assert agent_state.consecutive_high_fatigue == 0
    assert agent_state.handoff_triggered is False
