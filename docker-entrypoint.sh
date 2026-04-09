#!/bin/sh
set -eu

adb start-server

exec bun server/index.ts
