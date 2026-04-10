#!/bin/bash
# Health check: exits 0 if the wg0 WireGuard interface is active, non-zero otherwise.
# Used as the ACI liveness probe exec command: ['wg', 'show'] or this script.
wg show wg0 > /dev/null 2>&1
