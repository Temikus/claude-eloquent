#!/usr/bin/env python3
"""SessionEnd hook: drop this session's retry sentinels. The TTL prune in
check_comments.py covers sessions that end without this hook firing."""

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import SESSIONS_DIR, log, read_stdin, valid_session_id  # noqa: E402

try:
    event = json.loads(read_stdin(65536)[0])
    session_id = event.get("session_id", "")
    if not valid_session_id(session_id):
        sys.exit(0)

    shutil.rmtree(os.path.join(SESSIONS_DIR, session_id), ignore_errors=True)
    log("cleanup", "REMOVED: sentinels for session={}".format(session_id))
    sys.exit(0)
except SystemExit:
    raise
except Exception as err:
    log("cleanup", "ERROR: unexpected failure: {}".format(err))
    sys.exit(0)
