"""
Dhyan — centralized configuration.
All tunable values live here. Never scatter magic numbers in other files.
"""

# LM Studio / Gemma 4
LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"
MODEL_NAME = "google/gemma-4-e4b"
GEMMA_TIMEOUT_SECONDS = 30
GEMMA_MAX_TOKENS = 900
GEMMA_TEMPERATURE = 0.4

# Agent loop
AGENT_CHECK_INTERVAL_DEFAULT_MS = 600_000   # 10 minutes
AGENT_CHECK_INTERVAL_MIN_MS = 30_000        # 30 seconds (demo)
AGENT_HANDOFF_THRESHOLD = 3                 # consecutive HIGH fatigue → handoff
AGENT_CAPTURE_QUALITY = 0.65               # JPEG quality — balance size vs accuracy

# Presence detection
PRESENCE_MOTION_THRESHOLD = 15             # pixel diff to confirm user present
PRESENCE_FACE_REQUIRED = True              # only analyze if face detected in frame
PRESENCE_SKIP_DARK_FRAME = True           # skip if frame is too dark (screen off)
PRESENCE_DARK_THRESHOLD = 20             # avg pixel brightness below this = dark

# Performance / battery
CAPTURE_WIDTH = 480                        # reduced from 640 — saves ~40% compute
CAPTURE_HEIGHT = 360                       # reduced from 480
MAX_IMAGE_BYTES = 3 * 1024 * 1024        # 3MB max

# Session
SESSION_SECRET = "dhyan-local-only-2026"
MAX_CONTENT_LENGTH = 5 * 1024 * 1024

# Sound (defaults — user can override in UI)
SOUND_ENABLED_DEFAULT = True
SOUND_VOLUME_DEFAULT = 0.6

# Mobile awareness
MOBILE_CHECK_ENABLED_DEFAULT = False       # opt-in feature
MOBILE_DISTRACTION_WINDOW_SECONDS = 300   # 5 min window to track phone pickups
