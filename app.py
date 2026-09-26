"""
Dhyan - Privacy-First AI Wellness Agent
Powered by Gemma 4 running 100% locally via LM Studio.
No data leaves your machine.
"""

import logging
from flask import Flask, request
from flask_cors import CORS
from flask_compress import Compress

from config import SESSION_SECRET, MAX_CONTENT_LENGTH
from routes import register_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = SESSION_SECRET
    app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
    app.config["COMPRESS_MIMETYPES"] = [
        "text/html", "text/css", "text/xml",
        "application/json", "application/javascript", "text/javascript",
    ]

    Compress(app)
    CORS(app, resources={r"/*": {"origins": [
        "chrome-extension://*",
        "http://localhost:*",
        "http://127.0.0.1:*",
    ]}})

    @app.after_request
    def add_cache_headers(response):
        if request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "public, max-age=86400"
        return response

    register_routes(app)
    logger.info("Dhyan started — all data stays local.")
    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, port=5000)
