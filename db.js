// Stockage dans le téléphone (IndexedDB). Aucune donnée ne part sur Internet.
const NOM = "inventaire-qr";
export const TABLES = ["meta", "categories", "locations", "items", "movements", "photos"];

let ouverture;
function base() {
  ouverture ??= new Promise((ok, ko) => {
    const req = indexedDB.open(NOM, 1);
    req.onupgradeneeded = () => {
      for (const t of TABLES) req.result.createObjectStore(t, { keyPath: "id" });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error);
  });
  return ouverture;
}

const attendre = (req) =>
  new Promise((ok, ko) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error);
  });

export const tout = async (table) => attendre((await base()).transaction(table).objectStore(table).getAll());
export const lire = async (table, id) => attendre((await base()).transaction(table).objectStore(table).get(id));

/** Écrit plusieurs lignes dans plusieurs tables en une seule fois : tout passe, ou rien. */
export async function ecrire(lignes) {
  const tables = [...new Set(lignes.map((l) => l.table))];
  const tx = (await base()).transaction(tables, "readwrite");
  for (const l of lignes) {
    if (l.supprimer) tx.objectStore(l.table).delete(l.supprimer);
    else tx.objectStore(l.table).put(l.valeur);
  }
  return new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => ko(tx.error);
  });
}

/** Remplace tout le contenu par celui d'une sauvegarde. */
export async function remplacerTout(donnees) {
  const tx = (await base()).transaction(TABLES, "readwrite");
  for (const t of TABLES) {
    const store = tx.objectStore(t);
    store.clear();
    for (const v of donnees[t] ?? []) store.put(v);
  }
  return new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => ko(tx.error);
  });
}
