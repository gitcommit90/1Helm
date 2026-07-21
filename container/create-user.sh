#!/bin/sh
set -eu

if ! getent group "${CONTAINER_GID}" >/dev/null 2>&1; then
  echo "${CONTAINER_USER}:x:${CONTAINER_GID}:" >> /etc/group
fi
if ! getent passwd "${CONTAINER_UID}" >/dev/null 2>&1; then
  echo "${CONTAINER_USER}:x:${CONTAINER_UID}:${CONTAINER_GID}:1Helm channel agent:${CONTAINER_HOME}:${CONTAINER_SHELL:-/bin/bash}" >> /etc/passwd
  echo "${CONTAINER_USER}:!:19000:0:99999:7:::" >> /etc/shadow
fi

mkdir -p "${CONTAINER_HOME}" /workspace/files /etc/sudoers.d
if [ -d /etc/skel ]; then cp -a /etc/skel/. "${CONTAINER_HOME}/"; fi
chown -R "${CONTAINER_UID}:${CONTAINER_GID}" "${CONTAINER_HOME}" /workspace
echo "${CONTAINER_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${CONTAINER_USER}"
chmod 0440 "/etc/sudoers.d/${CONTAINER_USER}"
