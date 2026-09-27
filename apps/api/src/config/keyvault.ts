/**
 * Azure Key Vault wiring (S5-05). When KEY_VAULT_URL is set, secrets named in KEY_VAULT_SECRETS
 * ("ENV_NAME=secret-name,ENV_NAME2=secret-name-2") are read with the default Azure credential (managed
 * identity in Azure, developer sign-in locally) and placed in process.env before the environment is parsed.
 * Values already present in the environment win, so container-level overrides stay possible.
 */
export async function loadSecretsFromKeyVault(
  source: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const url = source.KEY_VAULT_URL;
  if (!url) return [];
  const mapping = (source.KEY_VAULT_SECRETS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [envName, secretName] = pair.split('=');
      return { envName: envName!.trim(), secretName: (secretName ?? envName!).trim() };
    });
  if (mapping.length === 0) return [];
  const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
    import('@azure/keyvault-secrets'),
    import('@azure/identity'),
  ]);
  const client = new SecretClient(url, new DefaultAzureCredential());
  const loaded: string[] = [];
  for (const { envName, secretName } of mapping) {
    if (source[envName]) continue;
    const secret = await client.getSecret(secretName);
    if (secret.value !== undefined) {
      source[envName] = secret.value;
      loaded.push(envName);
    }
  }
  return loaded;
}
