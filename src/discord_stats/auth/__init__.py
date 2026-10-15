"""Authentication and privilege.

`auth.session` owns sessions and the two FastAPI dependencies, `auth.allowlist`
decides who gets in, `auth.oauth` talks to Discord. The API imports
`require_viewer`/`require_admin`; nothing else in the app needs to know how a
request was authenticated.
"""

from discord_scraper.auth.session import Level, require_admin, require_viewer

__all__ = ["Level", "require_admin", "require_viewer"]
