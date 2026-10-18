"""The dashboard's packaging contract: the web extra, and one console script.

`python-multipart` was once hand-installed into a dev venv, so every test passed
while a clean install and the container died on the admin upload's form parsing.
The extra is the contract, and it moved here with the web code; this pins it in
the repo that now owns it.
"""

from __future__ import annotations

import tomllib
from pathlib import Path


def test_the_web_extra_lists_everything_the_server_imports():
    project = tomllib.loads(Path("pyproject.toml").read_text())["project"]
    extra = " ".join(project["optional-dependencies"]["web"])
    for package in ("fastapi", "uvicorn", "httpx", "itsdangerous", "apscheduler",
                    "python-multipart"):
        assert package in extra, package


def test_the_dashboard_leaves_the_tool_its_own_metadata():
    """`pnpm install` brings the tool in; this repo must not redeclare it."""
    project = tomllib.loads(Path("pyproject.toml").read_text())["project"]
    assert project["scripts"] == {"discord-stats": "discord_stats.cli:main"}
    assert project["dependencies"] == []
