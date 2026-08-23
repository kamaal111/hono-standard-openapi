set export

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

# Run all sanity checks
[parallel]
ready: quality test-cov

# Run quality checks
[parallel]
quality: format-check lint type-check

# Test package
test:
    {{ PNR }} test

# Test package with watch
test-watch:
    {{ PNR }} test:watch

# Test package with coverage
test-cov:
    {{ PNR }} test:cov

# Compile package
compile:
    {{ PNR }} compile

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
