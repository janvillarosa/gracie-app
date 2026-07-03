# gracie-app — canonical command surface.
# Run `make check` before every commit. `make help` lists all targets.
# CI, humans, and coding agents all invoke these same targets.

BACKEND  := backend
FRONTEND := frontend
GOLANGCI_VERSION := v2.12.2

.DEFAULT_GOAL := help
.PHONY: help setup fmt fmt-check lint typecheck vet build test-unit test-integration cover check golangci-lint-bin

help: ## List available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

setup: ## Install backend + frontend dependencies
	cd $(BACKEND) && go mod download
	cd $(FRONTEND) && pnpm install --frozen-lockfile

check: fmt-check vet lint typecheck build test-unit ## Fast pre-commit gate (no external services)
	@echo "✓ make check passed"

# Exclude local Go cache/tmp/bin dirs (leading-dot dirs are skipped by `go`
# tooling but not by a raw `gofmt` filesystem walk).
BE_GOFILES = find . -name '*.go' -not -path './.gocache*' -not -path './.gotmp*' -not -path './bin/*'

fmt: ## Auto-format: backend (gofmt) + frontend (biome)
	cd $(BACKEND) && gofmt -w $$($(BE_GOFILES))
	cd $(FRONTEND) && pnpm format

fmt-check: ## Verify formatting without writing (fails if unformatted)
	@out=$$(cd $(BACKEND) && gofmt -l $$($(BE_GOFILES))); \
	  if [ -n "$$out" ]; then echo "gofmt needed for:"; echo "$$out"; exit 1; fi
	cd $(FRONTEND) && pnpm format:check

vet: ## go vet (backend)
	cd $(BACKEND) && go vet ./...

lint: golangci-lint-bin ## Lint: backend (golangci-lint) + frontend (biome)
	cd $(BACKEND) && ./bin/golangci-lint run ./...
	cd $(FRONTEND) && pnpm lint

typecheck: ## Typecheck frontend (tsc --noEmit)
	cd $(FRONTEND) && pnpm typecheck

build: ## Build backend + frontend
	cd $(BACKEND) && go build ./...
	cd $(FRONTEND) && pnpm build

test-unit: ## Fast tests: backend (no DB) + frontend (with coverage gate)
	cd $(BACKEND) && go test ./... -count=1
	cd $(FRONTEND) && pnpm test:ci

test-integration: ## Slow tests: backend integration, needs Mongo (see .env.example)
	cd $(BACKEND) && go test -tags=integration ./... -count=1 -v

cover: ## Backend coverage profile + total
	cd $(BACKEND) && go test ./... -count=1 -coverprofile=cover.out && go tool cover -func=cover.out | tail -1

# Bootstrap golangci-lint into backend/bin (gitignored) if it isn't present.
golangci-lint-bin:
	@test -x $(BACKEND)/bin/golangci-lint || \
	  (echo "installing golangci-lint $(GOLANGCI_VERSION)..." && \
	   cd $(BACKEND) && GOBIN=$$PWD/bin go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION))
