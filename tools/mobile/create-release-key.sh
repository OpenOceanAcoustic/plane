#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo 'Usage: tools/mobile/create-release-key.sh /private/absolute/key-directory' >&2
  exit 2
fi
key_dir="$1"
if [[ "$key_dir" != /* ]]; then
  echo 'The key directory must be absolute.' >&2
  exit 2
fi
if [ -f "$key_dir/signing.properties" ]; then
  echo "Existing release key retained: $key_dir/signing.properties"
  exit 0
fi
umask 077
mkdir -p "$key_dir"
if [ -e "$key_dir/release.jks" ]; then
  echo 'A keystore already exists without properties; refusing to replace it.' >&2
  exit 1
fi
export OOA_KEY_PASSWORD
OOA_KEY_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
keytool -genkeypair -keystore "$key_dir/release.jks" -storetype PKCS12 -alias openoceanacoustic \
  -storepass:env OOA_KEY_PASSWORD -keypass:env OOA_KEY_PASSWORD -keyalg RSA -keysize 3072 \
  -validity 10000 -dname 'CN=OpenOceanAcoustic Android, O=OpenOceanAcoustic' >/dev/null 2>&1
KEY_OUTPUT_DIR="$key_dir" python3 - <<'PY'
import os
from pathlib import Path
root = Path(os.environ['KEY_OUTPUT_DIR'])
password = os.environ['OOA_KEY_PASSWORD']
path = str(root / 'release.jks').replace('\\', '\\\\').replace(':', '\\:')
(root / 'signing.properties').write_text(
    f'storeFile={path}\nstorePassword={password}\nkeyAlias=openoceanacoustic\nkeyPassword={password}\n'
)
PY
unset OOA_KEY_PASSWORD
echo "Release key created: $key_dir/signing.properties"
