export async function requireOk(response, product) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${product}: accès refusé (${response.status}). Vérifie les droits utilisateur, les scopes et l'installation de DriftSignal sur les deux produits.`);
    }
    throw new Error(`${product}: API HTTP ${response.status}. Consulte les logs Forge.`);
  }
  return response.json();
}
