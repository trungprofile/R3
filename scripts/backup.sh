#!/usr/bin/env bash
# Nightly pg_dump written to the box, retaining ~two weeks of nightly dumps plus
# several weekly snapshots (architecture.md §5.3).
#
# ACCEPTED RISK, stated plainly: off-box copies are deferred until go-live, so a
# single disk failure destroys the database AND every backup of it — they share a
# disk. REVISIT THE DAY REAL DATA EXISTS; the NTFB reporting history is compliance
# data.

set -euo pipefail

echo "TODO: implement before go-live."
exit 1
