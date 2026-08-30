#!/usr/bin/env bash
# Expect: trailing comment on 5 ($# is not one), block on 7.

set -euo pipefail
count=$#            # positional arg count
echo "${count} args"
# Explains the exit code choice.
exit 0
