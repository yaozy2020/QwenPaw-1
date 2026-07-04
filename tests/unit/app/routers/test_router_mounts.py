# -*- coding: utf-8 -*-
"""Unit tests for top-level router composition."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.routers import router
from qwenpaw.config.config import AgentsLLMRoutingConfig


def test_global_llm_routing_router_is_mounted() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    config = SimpleNamespace(
        agents=SimpleNamespace(
            llm_routing=AgentsLLMRoutingConfig(
                fallback={
                    "enabled": True,
                    "models": [
                        {
                            "provider_id": "dashscope",
                            "model": "qwen-plus",
                        },
                    ],
                },
            ),
        ),
    )

    with patch("qwenpaw.app.routers.config.load_config", return_value=config):
        response = TestClient(app).get(
            "/api/global-config/agents/llm-routing",
        )

    assert response.status_code == 200
    assert response.json()["fallback"] == {
        "enabled": True,
        "models": [{"provider_id": "dashscope", "model": "qwen-plus"}],
    }
