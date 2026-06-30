# OpenGander — self-hosted GenAI/LLM observability.
#
# Usage:
#   make up       Build and start the full self-hosted stack
#   make down     Stop the stack (keeps data volumes)
#   make logs     Tail logs from all services
#   make migrate  Apply Postgres (Drizzle) migrations
#   make jaeger   Start standalone Jaeger for span debugging

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Self-hosted stack = base infra (clickhouse + postgres + collector) + app overlay.
COMPOSE := docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.full.yml

.PHONY: help up down logs migrate jaeger

up: ## Build and start the full self-hosted stack
	$(COMPOSE) up --build -d

down: ## Stop the stack (keeps volumes/data)
	$(COMPOSE) down

logs: ## Tail logs from all stack services
	$(COMPOSE) logs -f

migrate: ## Apply Postgres (Drizzle) migrations
	$(COMPOSE) run --rm web-migrate

jaeger: ## Start standalone Jaeger (span debugging) at http://localhost:16686
	docker compose -f infra/compose/docker-compose.test.yml up -d

help: ## Show this help
	@echo "OpenGander — self-hosted GenAI/LLM observability"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
