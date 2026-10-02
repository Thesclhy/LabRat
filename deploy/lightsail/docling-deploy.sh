#!/usr/bin/env bash

check_docling_resources() {
  local deploy_root="${1:?deployment root required}"
  local memory_kib available_bytes
  memory_kib="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  (( memory_kib >= 7 * 1024 * 1024 )) || {
    echo "Docling deployment requires the approved 8GB instance; no migration was run." >&2
    return 1
  }
  available_bytes="$(df --output=avail -B1 "$deploy_root" | tail -n 1 | tr -d ' ')"
  (( available_bytes >= 8 * 1024 * 1024 * 1024 )) || {
    echo "Docling deployment requires 8GiB of free disk space." >&2
    return 1
  }
  python3.12 -c 'import sys; assert sys.version_info[:2] == (3, 12)' || return 1
  printf 'Docling resource preflight: memory=%sKiB free-disk=%sB\n' "$memory_kib" "$available_bytes" >&2
}

prepare_docling_runtime() {
  local release="${1:?release required}" docling_root="${2:?parser root required}"
  local source="$release/services/docling" runtime_hash model_hash runtime models
  [[ "$EUID" == "0" ]] || { echo "Parser preparation requires root." >&2; return 1; }
  [[ "$docling_root" =~ ^/[a-zA-Z0-9_./-]+$ ]] || return 1
  test -f "$source/requirements-linux.lock" || {
    echo "The release is missing the verified Linux parser lockfile." >&2; return 1;
  }
  runtime_hash="$(cat "$source/requirements-linux.lock" "$source/run.py" "$source/smoke.py" \
    "$source/model-manifest.json" | sha256sum | cut -d ' ' -f 1)"
  model_hash="$(sha256sum "$source/model-manifest.json" | cut -d ' ' -f 1)"
  runtime="$docling_root/runtimes/$runtime_hash"
  models="$docling_root/models/$model_hash"

  if ! id labrat-docling >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/labrat-docling --shell /usr/sbin/nologin labrat-docling || return 1
  fi
  install -d -m 0755 "$docling_root/runtimes" "$docling_root/models" "$runtime/service" "$models" || return 1
  install -d -m 0700 -o labrat-docling -g labrat-docling /var/lib/labrat-docling || return 1
  cp -R "$source/." "$runtime/service/" || return 1
  chown -R root:root "$runtime/service" || return 1
  if [[ ! -f "$runtime/.runtime-ready" ]]; then
    apt-get update -qq >&2 || return 1
    apt-get install -y --no-install-recommends python3.12-venv libgl1 libglib2.0-0t64 libgomp1 >&2 || return 1
    python3.12 -m venv "$runtime/venv" || return 1
    "$runtime/venv/bin/python" -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu 'torch==2.12.0' 'torchvision==0.27.0' >&2 || return 1
    "$runtime/venv/bin/python" -m pip install --no-cache-dir -r "$source/requirements-linux.lock" >&2 || return 1
    "$runtime/venv/bin/python" -m pip check >&2 || return 1
    "$runtime/venv/bin/python" "$source/collect-notices.py" "$runtime/notices" >&2 || return 1
    touch "$runtime/.runtime-ready" || return 1
  fi
  "$runtime/venv/bin/python" "$source/prepare-models.py" "$models" >&2 || return 1
  chown -R root:root "$runtime" "$models" || return 1
  chmod -R go-w "$runtime" "$models" || return 1
  ln -sfn "$models" "$runtime/models" || return 1
  if [[ ! -f /etc/labrat/docling.key ]]; then
    python3.12 -c 'import os,secrets; fd=os.open("/etc/labrat/docling.key", os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o640); os.write(fd, (secrets.token_urlsafe(32)+"\n").encode()); os.close(fd)' || return 1
  fi
  [[ ! -L /etc/labrat/docling.key ]] || return 1
  chown root:labrat-docling /etc/labrat/docling.key || return 1
  chmod 0640 /etc/labrat/docling.key || return 1
  cat > /etc/systemd/system/labrat-docling.service <<EOF || return 1
[Unit]
Description=LabRat offline PDF recognition
After=network.target

[Service]
Type=simple
User=labrat-docling
Group=labrat-docling
WorkingDirectory=$docling_root/current/service
ExecStart=$docling_root/current/venv/bin/python -u $docling_root/current/service/run.py --models $docling_root/current/models --scratch /var/lib/labrat-docling/docling-scratch --key-file /etc/labrat/docling.key --port 5059
Environment=HF_HOME=/var/lib/labrat-docling/cache
Environment=XDG_CACHE_HOME=/var/lib/labrat-docling/cache
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
MemoryMax=4G
CPUQuota=150%
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/labrat-docling
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
IPAddressDeny=any
IPAddressAllow=localhost

[Install]
WantedBy=multi-user.target
EOF
  [[ -s /etc/systemd/system/labrat-docling.service ]] || return 1
  systemctl daemon-reload || return 1
  printf '%s\n' "$runtime"
}

docling_health_check() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 http://127.0.0.1:5059/health >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

activate_docling_runtime() {
  local runtime="${1:?runtime required}" docling_root="${2:?parser root required}"
  [[ "$runtime" == "$docling_root/runtimes/"* && -f "$runtime/.runtime-ready" ]] || return 1
  ln -sfn "$runtime" "$docling_root/current" || return 1
  systemctl enable labrat-docling.service >/dev/null || return 1
  systemctl restart labrat-docling.service || return 1
  docling_health_check || return 1
  sudo -H -u labrat-docling "$runtime/venv/bin/python" "$runtime/service/smoke.py" \
    --key-file /etc/labrat/docling.key || return 1
}

rollback_docling_runtime() {
  local previous="${1:-}" docling_root="${2:?parser root required}"
  if [[ -n "$previous" ]]; then
    [[ "$previous" == "$docling_root/runtimes/"* && -d "$previous" ]] || return 1
    ln -sfn "$previous" "$docling_root/current" || return 1
    systemctl restart labrat-docling.service || return 1
    docling_health_check || return 1
  else
    systemctl disable --now labrat-docling.service || return 1
    rm -f -- "$docling_root/current"
  fi
}
