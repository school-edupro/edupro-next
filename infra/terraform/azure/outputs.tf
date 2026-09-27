output "api_fqdn" { value = module.api.fqdn }
output "admin_fqdn" { value = module.admin.fqdn }
output "key_vault_uri" { value = azurerm_key_vault.kv.vault_uri }
output "postgres_fqdn" { value = azurerm_postgresql_flexible_server.db.fqdn }
