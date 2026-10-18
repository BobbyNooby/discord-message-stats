"""The read-only web API.

Nothing in this package writes: the database is opened with SQLite's own
read-only mode (``api.deps.connect``), so "the viewer cannot change anything" is
a property of the file handle rather than a rule the code remembers to follow.
"""

from discord_stats.api.app import create_app

__all__ = ["create_app"]
