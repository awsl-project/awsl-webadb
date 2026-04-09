#!/bin/sh
set -eu

adb -a start-server

exec bun server/index.ts
