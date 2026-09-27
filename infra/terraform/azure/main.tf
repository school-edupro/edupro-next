# EduPro Next staging and production on Azure (S5-05). One environment per workspace.
terraform {
  required_version = ">= 1.8"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
  }
  backend "azurerm" {} # state storage account and container are passed with -backend-config
}

provider "azurerm" {
  features {
    key_vault { purge_soft_delete_on_destroy = false }
  }
}

locals {
  name = "edupro-${var.environment}"
  tags = { product = "edupro-next", environment = var.environment, managed_by = "terraform" }
}

resource "azurerm_resource_group" "rg" {
  name     = "${local.name}-rg"
  location = var.location
  tags     = local.tags
}

# ---- data --------------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server" "db" {
  name                          = "${local.name}-pg"
  resource_group_name           = azurerm_resource_group.rg.name
  location                      = azurerm_resource_group.rg.location
  version                       = "16"
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = 35
  geo_redundant_backup_enabled  = var.environment == "production"
  administrator_login           = "edupro_migrator"
  administrator_password        = random_password.pg.result
  public_network_access_enabled = false
  delegated_subnet_id           = azurerm_subnet.data.id
  private_dns_zone_id           = azurerm_private_dns_zone.pg.id
  zone                          = "1"
  high_availability {
    mode = var.environment == "production" ? "ZoneRedundant" : "SameZone"
  }
  tags = local.tags
}

resource "azurerm_postgresql_flexible_server_database" "edupro" {
  name      = "edupro"
  server_id = azurerm_postgresql_flexible_server.db.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.db.id
  value     = "PG_TRGM,UNACCENT,CITEXT"
}

resource "azurerm_redis_cache" "redis" {
  name                = "${local.name}-redis"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  capacity            = var.environment == "production" ? 2 : 0
  family              = var.environment == "production" ? "P" : "C"
  sku_name            = var.environment == "production" ? "Premium" : "Basic"
  minimum_tls_version = "1.2"
  tags                = local.tags
}

resource "azurerm_storage_account" "files" {
  name                            = replace("${local.name}files", "-", "")
  resource_group_name             = azurerm_resource_group.rg.name
  location                        = azurerm_resource_group.rg.location
  account_tier                    = "Standard"
  account_replication_type        = var.environment == "production" ? "GRS" : "LRS"
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"
  blob_properties {
    delete_retention_policy { days = 30 }
    versioning_enabled = true
  }
  tags = local.tags
}

resource "azurerm_storage_container" "uploads" {
  name                  = "uploads"
  storage_account_name  = azurerm_storage_account.files.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "backups" {
  name                  = "backups"
  storage_account_name  = azurerm_storage_account.files.name
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "backups" {
  storage_account_id = azurerm_storage_account.files.id
  rule {
    name    = "backup-retention"
    enabled = true
    filters { prefix_match = ["backups/"] }
    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than = 7
        delete_after_days_since_modification_greater_than       = 365
      }
    }
  }
}

# ---- secrets -----------------------------------------------------------------------------------
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "kv" {
  name                       = "${local.name}-kv"
  resource_group_name        = azurerm_resource_group.rg.name
  location                   = azurerm_resource_group.rg.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  rbac_authorization_enabled = true
  tags                       = local.tags
}

resource "random_password" "pg" {
  length  = 32
  special = false
}

resource "random_password" "session" {
  length = 48
}

resource "azurerm_key_vault_secret" "database_url" {
  name         = "database-url"
  key_vault_id = azurerm_key_vault.kv.id
  value        = "postgresql://edupro_app:${random_password.app.result}@${azurerm_postgresql_flexible_server.db.fqdn}:5432/edupro?sslmode=require"
}

resource "random_password" "app" {
  length  = 32
  special = false
}

resource "azurerm_key_vault_secret" "database_migrator_url" {
  name         = "database-migrator-url"
  key_vault_id = azurerm_key_vault.kv.id
  value        = "postgresql://edupro_migrator:${random_password.pg.result}@${azurerm_postgresql_flexible_server.db.fqdn}:5432/edupro?sslmode=require"
}

resource "azurerm_key_vault_secret" "session_secret" {
  name         = "session-secret"
  key_vault_id = azurerm_key_vault.kv.id
  value        = base64encode(random_password.session.result)
}

# ---- compute (Container Apps) -------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "logs" {
  name                = "${local.name}-logs"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  retention_in_days   = 90
  tags                = local.tags
}

resource "azurerm_container_app_environment" "env" {
  name                       = "${local.name}-cae"
  resource_group_name        = azurerm_resource_group.rg.name
  location                   = azurerm_resource_group.rg.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
  infrastructure_subnet_id   = azurerm_subnet.apps.id
  tags                       = local.tags
}

resource "azurerm_user_assigned_identity" "apps" {
  name                = "${local.name}-apps"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
}

resource "azurerm_role_assignment" "kv_reader" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.apps.principal_id
}

resource "azurerm_role_assignment" "blob" {
  scope                = azurerm_storage_account.files.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.apps.principal_id
}

module "api" {
  source       = "./modules/container-app"
  name         = "${local.name}-api"
  environment  = azurerm_container_app_environment.env.id
  identity_id  = azurerm_user_assigned_identity.apps.id
  image        = "${var.image_prefix}/api:${var.image_tag}"
  port         = 4000
  external     = true
  min_replicas = var.environment == "production" ? 2 : 1
  env = {
    NODE_ENV          = "production"
    KEY_VAULT_URL     = azurerm_key_vault.kv.vault_uri
    KEY_VAULT_SECRETS = "DATABASE_URL=database-url,SESSION_SECRET=session-secret,FILES_SIGNING_SECRET=files-signing-secret,COMPAT_JWT_SECRET=compat-jwt-secret,COMPAT_HANDSHAKE_SECRET=compat-handshake-secret,IMPERSONATION_JWT_SECRET=impersonation-jwt-secret,METRICS_TOKEN=metrics-token"
    REDIS_URL         = "rediss://:${azurerm_redis_cache.redis.primary_access_key}@${azurerm_redis_cache.redis.hostname}:6380"
    STORAGE_DRIVER    = "s3"
    S3_BUCKET         = azurerm_storage_container.uploads.name
    S3_REGION         = var.location
    S3_ENDPOINT       = "https://${azurerm_storage_account.files.name}.blob.core.windows.net"
    S3_FORCE_PATH_STYLE = "true"
    ONEAUTH_ISSUER    = var.oneauth_issuer
    ONEAUTH_AUDIENCE  = var.oneauth_audience
    ONEAUTH_JWKS_URL  = "${var.oneauth_issuer}/.well-known/jwks.json"
    API_BASE_URL      = "https://api.${var.dns_zone}"
    CORS_ORIGINS      = "https://admin.${var.dns_zone},https://parent.${var.dns_zone},https://teacher.${var.dns_zone}"
    OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_endpoint
  }
  tags = local.tags
}

module "workers" {
  source       = "./modules/container-app"
  name         = "${local.name}-workers"
  environment  = azurerm_container_app_environment.env.id
  identity_id  = azurerm_user_assigned_identity.apps.id
  image        = "${var.image_prefix}/workers:${var.image_tag}"
  port         = 0
  external     = false
  min_replicas = 1
  env = merge(module.api.env, { DATABASE_MIGRATOR_URL = "" })
  tags = local.tags
}

module "admin" {
  source       = "./modules/container-app"
  name         = "${local.name}-admin"
  environment  = azurerm_container_app_environment.env.id
  identity_id  = azurerm_user_assigned_identity.apps.id
  image        = "${var.image_prefix}/admin:${var.image_tag}"
  port         = 3000
  external     = true
  min_replicas = var.environment == "production" ? 2 : 1
  env = {
    NODE_ENV              = "production"
    INTERNAL_API_BASE_URL = "https://${module.api.fqdn}"
    KEY_VAULT_URL         = azurerm_key_vault.kv.vault_uri
    KEY_VAULT_SECRETS     = "SESSION_SECRET=session-secret,ONEAUTH_CLIENT_SECRET=oneauth-client-secret"
    ONEAUTH_ISSUER        = var.oneauth_issuer
    ONEAUTH_CLIENT_ID     = var.oneauth_client_id
    ONEAUTH_REDIRECT_URI  = "https://admin.${var.dns_zone}/api/auth/callback"
  }
  tags = local.tags
}
