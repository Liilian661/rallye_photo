// audit: MED-019 — Utilitaire d'echappement HTML pour neutraliser toute
// injection de contenu (XSS/phishing) lorsqu'une valeur controlee par
// l'utilisateur (ex: firstName) est interpolee dans un template HTML d'email.
//
// Echappe les 5 caracteres significatifs en HTML. Les valeurs non-string sont
// converties en chaine de facon defensive.
export function escapeHtml(input: unknown): string {
  const str = input == null ? '' : String(input);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
