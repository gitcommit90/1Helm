// What every command on a channel's computer starts with, so pip and npm installs are kept.
// Only /workspace is saved (channel-computer.js), and the image's own pip and npm write under /usr/local, which is not.
// HOME is /workspace/.home, so pip's user folder (~/.local) is already saved. npm's global folder is moved there too.
// Download caches go to /tmp, because everything under /workspace is packed into the saved layers.
export const HOME_DIR = "/workspace/.home";
export const PIP_BIN = `${HOME_DIR}/.local/bin`;
export const NPM_PREFIX = `${HOME_DIR}/.npm-global`;
export const COMPUTER_ENV = {
  HOME: HOME_DIR,
  PYTHONUSERBASE: `${HOME_DIR}/.local`,
  PIP_NO_CACHE_DIR: "1",
  npm_config_prefix: NPM_PREFIX,
  npm_config_cache: "/tmp/.npm-cache",
};
// PIP_USER=1 would make pip refuse --target and installs inside a venv, so `pip install` is made a user install by these
// functions instead, and only when the command did not ask for --user, --target, --prefix, --root or --system and no venv is active.
// A path such as .venv/bin/pip does not go through them. The two bin folders come after the image's own PATH, so they shadow nothing.
export const COMPUTER_SHELL_PREFIX = `export PATH="$PATH:${PIP_BIN}:${NPM_PREFIX}/bin"
__1hc_user() { [ "$1" = install ] || return 1; [ -z "$VIRTUAL_ENV" ] || return 1; local x; for x in "\${@:2}"; do case "$x" in --user|--target|--target=*|-t|--prefix|--prefix=*|--root|--root=*|--system) return 1;; esac; done; return 0; }
pip() { if __1hc_user "$@"; then command pip install --user "\${@:2}"; else command pip "$@"; fi; }
pip3() { if __1hc_user "$@"; then command pip3 install --user "\${@:2}"; else command pip3 "$@"; fi; }
python3() { if [ "$1" = -m ] && [ "$2" = pip ] && __1hc_user "\${@:3}"; then command python3 -m pip install --user "\${@:4}"; else command python3 "$@"; fi; }
python() { if [ "$1" = -m ] && [ "$2" = pip ] && __1hc_user "\${@:3}"; then command python -m pip install --user "\${@:4}"; else command python "$@"; fi; }
export -f __1hc_user pip pip3 python3 python
`;
