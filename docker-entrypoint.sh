#!/bin/sh
set -eu

mkdir -p "${HOME}/.android"

adb -a start-server

exec ./awsl-webadb
