set export
set dotenv-load

PN := "pnpm"
PNR := PN + " run"

alias z := zed
alias fmt := format
alias fmt-c := format-check
alias prep := prepare
alias i := install-modules

# List available commands
default:
    just --list --unsorted

# Print the pnpm version required by package.json
pnpm-version:
    @jq -r '.devEngines.packageManager.version' package.json

# Run all sanity checks
ready: prepare ready-tasks

# Run quality checks
quality: prepare quality-tasks

# Test package
test:
    {{ PNR }} test

# Test package with watch
test-watch:
    {{ PNR }} test:watch

# Compile package
compile:
    {{ PNR }} compile

# Publish package
publish:
    {{ PNR }} release

# Format code
format:
    {{ PNR }} format

# Check code formatting
format-check:
    {{ PNR }} format:check

# Lint package
lint:
    {{ PNR }} lint

# Type check
type-check:
    {{ PNR }} type-check

# Prepare project to work with
prepare: install-modules

# Install all modules
install-modules:
    {{ PN }} i

# Open project in zed
zed:
    zed .

# Open project in vscode
code:
    code .

[private]
[parallel]
ready-tasks: quality-tasks test

[private]
[parallel]
quality-tasks: format-check lint type-check
