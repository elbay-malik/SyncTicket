#!/usr/bin/env bash
#
# The CI workflow, run locally. Mirrors .github/workflows/ci.yml step for step, in the same
# order, so that "ci:local passed" means the same thing as a green run on GitHub.
#
# It exists because GitHub Actions is not always available to this repo (a billing hold, a
# private repo's minutes, an offline afternoon), and "I ran the tests" is otherwise an
# unverifiable claim about an unknown subset. Keeping it a faithful mirror is the whole point:
# if you add a step to ci.yml, add it here, or this script starts lying.
#
# Differences from CI, all deliberate, all printed in the summary:
#
#   1. No clean checkout and no `pnpm install --frozen-lockfile`. This runs against the
#      node_modules you already have, which CI cannot do and you cannot un-do. If the lockfile
#      and your tree have diverged, this script will not notice — that is the one class of
#      failure only real CI catches.
#   2. The self-hosted search assets are verified present, not re-fetched. CI re-downloads the
#      ONNX runtime every run on purpose (see scripts/fetch-search-assets.mjs: skipping it
#      would keep a stale runtime on disk and mask exactly the bug that motivated ADR 0009).
#      Doing that before every push would cost 23.5 MB and a working network, so here it is
#      opt-in: --fetch-assets does what CI does. Missing assets are still a hard failure.
#   3. Your platform, not ubuntu-latest. Playwright's `--with-deps` is Linux-only and is
#      skipped; a failure that depends on the OS will not show up until CI runs.
#   4. No artifact upload. Playwright's report is left in playwright-report/ where it lands.
#
# Usage: pnpm ci:local [--no-e2e] [--keep-going] [--fetch-assets]

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

run_e2e=1
keep_going=0
fetch_assets=0

while [ $# -gt 0 ]; do
	case "$1" in
	--no-e2e) run_e2e=0 ;;
	--keep-going) keep_going=1 ;;
	--fetch-assets) fetch_assets=1 ;;
	-h | --help)
		# Everything from the third line to the first line that is not a comment, so the
		# help text cannot drift from the header it is printing.
		awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' "${BASH_SOURCE[0]}"
		exit 0
		;;
	*)
		echo "ci:local: unknown option '$1' (try --help)" >&2
		exit 2
		;;
	esac
	shift
done

if [ -t 1 ]; then
	bold=$'\033[1m' red=$'\033[31m' green=$'\033[32m' yellow=$'\033[33m' dim=$'\033[2m' off=$'\033[0m'
else
	bold='' red='' green='' yellow='' dim='' off=''
fi

names=()
states=()
seconds=()
failed=0

step() {
	local name="$1"
	shift
	local started elapsed status
	printf '\n%s━━ %s %s%s\n' "$bold" "$name" "$off" "$dim$*$off"
	started=$SECONDS
	"$@"
	status=$?
	elapsed=$((SECONDS - started))
	names+=("$name")
	seconds+=("$elapsed")
	if [ $status -eq 0 ]; then
		states+=(pass)
		printf '%s✓ %s%s (%ss)\n' "$green" "$name" "$off" "$elapsed"
	else
		states+=(FAIL)
		failed=1
		printf '%s✗ %s%s (%ss, exit %s)\n' "$red" "$name" "$off" "$elapsed" "$status"
		if [ $keep_going -eq 0 ]; then
			summary
			exit 1
		fi
	fi
	return 0
}

skip() {
	names+=("$1")
	states+=(skip)
	seconds+=(0)
}

# CI pins Node via .nvmrc; a different major here can pass locally and fail there.
check_node() {
	local want have
	if [ ! -f .nvmrc ]; then
		printf '%sNo .nvmrc here — ci:local must run from the repo root (pnpm ci:local does).%s\n' "$red" "$off" >&2
		return 1
	fi
	want=$(tr -d 'v[:space:]' <.nvmrc)
	have=$(node -v | tr -d 'v')
	if [ "${have%%.*}" != "${want%%.*}" ]; then
		printf '%sNode major mismatch: .nvmrc wants %s, this shell has %s%s\n' "$red" "$want" "$have" "$off" >&2
		return 1
	fi
	printf 'node %s matches .nvmrc (%s)\n' "$have" "$want"
}

# CI re-fetches; we only insist the assets are here, because e2e and the component tests
# both load them and their absence is a confusing failure three steps later.
check_assets() {
	local missing=0
	[ -f static/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx ] || missing=1
	[ -f static/ort/ort-wasm-simd-threaded.asyncify.wasm ] || missing=1
	if [ $missing -eq 1 ]; then
		printf '%sSelf-hosted search assets are missing. Run: pnpm fetch:search-assets%s\n' "$red" "$off" >&2
		return 1
	fi
	printf 'search assets present %s(not re-fetched — CI does; use --fetch-assets)%s\n' "$dim" "$off"
}

summary() {
	local i total=0
	printf '\n%s━━ summary %s\n' "$bold" "$off"
	for i in "${!names[@]}"; do
		total=$((total + seconds[i]))
		case "${states[i]}" in
		pass) printf '  %s✓%s %-44s %4ss\n' "$green" "$off" "${names[i]}" "${seconds[i]}" ;;
		FAIL) printf '  %s✗%s %-44s %4ss\n' "$red" "$off" "${names[i]}" "${seconds[i]}" ;;
		skip) printf '  %s–%s %-44s %s\n' "$yellow" "$off" "${names[i]}" "skipped" ;;
		esac
	done
	printf '  %s%-46s %4ss%s\n' "$dim" "total" "$total" "$off"

	printf '\n%sNot checked here, unlike CI:%s a clean checkout with --frozen-lockfile' "$dim" "$off"
	printf ' (your node_modules may have drifted from the lockfile); ubuntu-latest.\n'
	if [ $run_e2e -eq 0 ]; then
		printf '%sE2E WAS SKIPPED — this run does not stand in for CI.%s\n' "$yellow" "$off"
	fi
	if [ $failed -eq 0 ]; then
		printf '%s%sci:local green%s\n' "$bold" "$green" "$off"
	else
		printf '%s%sci:local failed%s\n' "$bold" "$red" "$off"
	fi
}

printf '%sci:local%s — mirroring .github/workflows/ci.yml\n' "$bold" "$off"

step "Node version matches .nvmrc" check_node
step "Typecheck (wrangler types + svelte-check)" pnpm check
step "Lint (prettier + eslint)" pnpm lint
step "Playwright chromium present" pnpm exec playwright install chromium
if [ $fetch_assets -eq 1 ]; then
	step "Fetch self-hosted search assets" pnpm fetch:search-assets
else
	step "Self-hosted search assets present" check_assets
fi
step "Unit & component tests (Vitest)" pnpm test:unit --run
if [ $run_e2e -eq 1 ]; then
	step "E2E tests (Playwright)" pnpm exec playwright test
else
	skip "E2E tests (Playwright)"
fi
step "Build (adapter-cloudflare)" pnpm build
step "Validate worker bundle (dry-run)" pnpm exec wrangler deploy --dry-run --outdir=.wrangler/dist
step "Typecheck the relay worker" pnpm --filter syncticket-relay run check
step "Validate relay bundle (dry-run)" pnpm --filter syncticket-relay run dry-run

summary
[ $failed -eq 0 ] || exit 1
