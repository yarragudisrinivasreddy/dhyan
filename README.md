# Dhyan ◈
### Privacy-First AI Wellness Agent — Powered by Gemma 4 (Local-First)

> **Problem Statement 5: Best Use of Gemma 4 (Local-First Agents)**  
> Full sense→decide→act→check agent loop. 100% offline. Zero data leaves your machine.

## The Problem

Screen workers spend 8–12 hours daily in front of monitors. This causes eye strain, poor posture, and mental fatigue. Most wellness tools send camera data to the cloud — a non-starter for privacy-conscious users and enterprises.

## Our Solution

**Dhyan** is a local-first AI wellness agent. It watches your posture and fatigue with your webcam, decides with Gemma 4 e4b running in LM Studio, acts with sound + notifications, and checks that you acknowledged the alert — then hands off to you after 3 consecutive high-fatigue readings.

## Why Local-First?

- Webcam frames never leave `localhost`
- Gemma 4 inference stays on-device via LM Studio
- Session state is in-memory only — nothing written to disk
- Open source (MIT)

## Agent Loop Architecture

```
Sense → Decide → Act → Check
  │        │       │      │
  │        │       │      └─ acknowledge / handoff
  │        │       └─ sounds + UI + OS notifications
  │        └─ Gemma 4 with trend + mobile context
  └─ presence (brightness / motion) before capture
```

## Gemma 4 Integration

- Model: `google/gemma-4-e4b` via LM Studio OpenAI-compatible API
- Multimodal: JPEG frame + structured JSON decision
- Trend context injected into the system prompt
- Offline recovery: last successful analysis cached in-memory

## Features

- Intelligent presence detection (skip dark / empty frames)
- Web Audio API sound system (optional, toggle in settings)
- Mobile distraction awareness (opt-in)
- Human handoff safety boundary (3× HIGH fatigue)
- Performance / battery mode (320×240 capture)
- Chrome Extension with OS notifications
- Posture reference visuals (Magnific-generated)

## Performance Benchmarks

- Capture resolution: 480×360 (vs 640×480 baseline ≈ 44% less data)
- Presence check: 160×120 (near-zero CPU cost)
- Estimated battery savings: ~30% vs naive always-analyze

## Setup

### Prerequisites

- [LM Studio](https://lmstudio.ai/) with `google/gemma-4-e4b` loaded, server on port `1234`
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended)

### Run locally

```bash
git clone https://github.com/yarragudisrinivasreddy/dhyan.git
cd dhyan
uv venv
uv pip install -r requirements.txt
uv run python app.py
```

Visit http://localhost:5000

### Tests

```bash
uv run pytest tests/ -v
```

## Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. **Load unpacked** → select the `extension/` folder
4. Pin Dhyan · start monitoring from the popup

All frames go only to `http://localhost:5000`.

## Product site

GitHub Pages: https://yarragudisrinivasreddy.github.io/dhyan  
(Enable Pages → Source: `docs/` folder on `main`)

## Team

- Srinivas Reddy

## License

MIT — Built for Google DeepMind Hackathon / Gemma 4 local-first agents
