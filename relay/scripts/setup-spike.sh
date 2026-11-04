#!/usr/bin/env bash
set -euo pipefail
# Install the pinned third-party SDK outside the public source tree. No inference is sent.
sdk_dir="${1:?usage: bash scripts/setup-spike.sh /absolute/temporary/sdk-directory}"
commit=a0bf5fdfde5c9179d50f7459bc36db6db326332e
git init "$sdk_dir"
git -C "$sdk_dir" remote add origin https://github.com/nearai/inference-sdk.git
git -C "$sdk_dir" fetch --depth 1 origin "$commit"
git -C "$sdk_dir" checkout --detach FETCH_HEAD
test "$(git -C "$sdk_dir" rev-parse HEAD)" = "$commit"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix "$sdk_dir/js" install --ignore-scripts
npm --prefix "$sdk_dir/js" run build
"$sdk_dir/js/node_modules/.bin/esbuild" "$sdk_dir/js/src/core/e2ee.ts" "$sdk_dir/js/src/core/e2ee-chat.ts" --bundle --platform=node --format=esm --packages=external --outdir="$sdk_dir/js/dist/probe"
python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ required"'
python3 -m venv "$sdk_dir/venv"
"$sdk_dir/venv/bin/python" -m pip install "$sdk_dir/py"
printf 'SDK ready. Set SPIKE_SDK_DIR=%s and run npm run spike after configuring the API key and model.\n' "$sdk_dir"
