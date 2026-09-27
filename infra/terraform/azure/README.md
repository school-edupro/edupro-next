# Azure environments (S5-05)

One workspace per environment (`staging`, `production`). Networking: a VNet with an apps subnet for Container
Apps and a delegated data subnet for PostgreSQL Flexible Server (private access only). Redis, a storage
account (uploads and backups with lifecycle rules) and a Key Vault with RBAC and purge protection complete
the environment. Secrets never appear in workflow files: the API and workers read them from Key Vault at
start through the user-assigned identity (`KEY_VAULT_URL`, `KEY_VAULT_SECRETS`), and the deploy workflow
authenticates with OIDC federation (`azure/login`).

```bash
cd infra/terraform/azure
terraform init -backend-config=backend.staging.hcl
terraform workspace select staging || terraform workspace new staging
terraform apply -var-file=staging.tfvars -var image_tag=<sha>
```

Secrets that are not generated here (One Auth client secret, compat and impersonation secrets, files
signing secret, metrics token) are written to the vault once with `az keyvault secret set`. The schema
version check in the API means a deploy whose migration job failed refuses to serve traffic.

Not yet exercised: no Azure subscription was available in Sprint 5, so `terraform validate` is the only
check that ran; the first `apply` happens with the platform team's subscription (M1 gate action).
