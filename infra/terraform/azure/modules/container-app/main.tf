variable "name" { type = string }
variable "environment" { type = string }
variable "identity_id" { type = string }
variable "image" { type = string }
variable "port" { type = number }
variable "external" { type = bool }
variable "min_replicas" { type = number }
variable "env" { type = map(string) }
variable "tags" { type = map(string) }

resource "azurerm_container_app" "app" {
  name                         = var.name
  container_app_environment_id = var.environment
  resource_group_name          = regex("resourceGroups/([^/]+)/", var.environment)[0]
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.min_replicas * 5
    container {
      name   = "app"
      image  = var.image
      cpu    = 1.0
      memory = "2Gi"
      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = regex("userAssignedIdentities/([^/]+)$", var.identity_id)[0]
      }
    }
  }

  dynamic "ingress" {
    for_each = var.port > 0 ? [1] : []
    content {
      external_enabled = var.external
      target_port      = var.port
      transport        = "http"
      traffic_weight {
        latest_revision = true
        percentage      = 100
      }
    }
  }
}

output "fqdn" { value = var.port > 0 ? azurerm_container_app.app.ingress[0].fqdn : "" }
output "env" { value = var.env }
