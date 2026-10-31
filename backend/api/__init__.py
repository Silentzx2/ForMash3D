# API module
try:
    from .main_multiworker import app
    __all__ = ["app"]
except Exception:
    app = None
    __all__ = []
