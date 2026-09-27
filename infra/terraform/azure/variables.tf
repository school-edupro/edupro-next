variable "environment" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}
variable "location" {
  type    = string
  default = "centralindia"
}
variable "image_prefix" {
  description = "Registry path, for example ghcr.io/school-edupro/edupro-next"
  type        = string
}
variable "image_tag" {
  type = string
}
variable "dns_zone" {
  description = "Public DNS zone, for example staging.edupro.example"
  type        = string
}
variable "postgres_sku" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}
variable "postgres_storage_mb" {
  type    = number
  default = 131072
}
variable "oneauth_issuer" { type = string }
variable "oneauth_audience" { type = string }
variable "oneauth_client_id" { type = string }
variable "otel_endpoint" {
  type    = string
  default = ""
}
