#!/bin/sh
set -eu

adb -a start-server

exec ./awsl-webadb
