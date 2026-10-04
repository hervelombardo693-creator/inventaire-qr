// Inventaire QR — version téléphone : tout fonctionne dans le navigateur, sans serveur.
import { ecrire, lire, remplacerTout, tout, TABLES } from "./db.js";

const app = document.getElementById("app");
const donnees = { profil: null, categories: [], locations: [], items: [], movements: [] };
let arreterCamera = null;
let erreur = "";
let invitationInstallation = null;

// ---------------------------------------------------------------- Libellés

const ETATS = {
  EN_STOCK: "En stock",
  EN_SERVICE: "En service",
  PRETE: "Prêté",
  EN_MAINTENANCE: "En maintenance",
  MANQUANT: "Manquant",
  HORS_SERVICE: "Hors service",
};
const MOUVEMENTS = {
  ENTREE: "Entrée en stock",
  SORTIE: "Sortie",
  DEPLACEMENT: "Déplacement",
  PRET: "Prêt",
  RETOUR: "Retour",
  MAINTENANCE: "Maintenance",
  PERTE: "Perte",
  REBUT: "Mise au rebut",
};
const AVEC_QUANTITE = ["ENTREE", "SORTIE", "PERTE", "REBUT"];

// ---------------------------------------------------------------- Outils

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const id = () => crypto.randomUUID();
/** Jeton imprévisible (128 bits) inscrit dans le QR code. */
const jeton = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const nombre = (v) => {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return String(v ?? "").trim() === "" || Number.isNaN(n) ? null : n;
};
const euros = (n) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const quantite = (q, unite) => `${Number(q).toLocaleString("fr-FR")} ${unite}`;
const jour = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
const jourHeure = (iso) =>
  new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const options = (liste, choisi, vide) =>
  (vide ? `<option value="">${esc(vide)}</option>` : "") +
  liste.map(([v, l]) => `<option value="${esc(v)}"${v === choisi ? " selected" : ""}>${esc(l)}</option>`).join("");

/** Chemin complet de chaque emplacement : « Fourgon → Étagère 2 ». */
function emplacements() {
  const parId = new Map(donnees.locations.map((l) => [l.id, l]));
  const chemin = (l) => {
    const noms = [l.name];
    const vus = new Set([l.id]);
    let p = parId.get(l.parentId);
    while (p && !vus.has(p.id)) {
      noms.unshift(p.name);
      vus.add(p.id);
      p = parId.get(p.parentId);
    }
    return noms.join(" → ");
  };
  return donnees.locations.map((l) => ({ id: l.id, chemin: chemin(l) })).sort((a, b) => a.chemin.localeCompare(b.chemin, "fr"));
}
const lieu = (lid, liste = emplacements()) =>
  lid ? (liste.find((e) => e.id === lid)?.chemin ?? "Emplacement supprimé") : "Sans emplacement";

/** Adresse inscrite dans le QR : ouvre l'application sur la fiche, même scannée avec l'appareil photo. */
const lienQr = (token) => `${location.origin}${location.pathname}#/q/${token}`;
const imageQr = (token, taille = 600) => QRCode.toDataURL(lienQr(token), { errorCorrectionLevel: "M", margin: 2, width: taille });

function telecharger(nom, contenu, type) {
  const url = contenu.startsWith("data:") ? contenu : URL.createObjectURL(new Blob([contenu], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Réduit la photo prise avec le téléphone pour ne pas remplir la mémoire. */
async function reduirePhoto(fichier, max = 1000) {
  const image = await createImageBitmap(fichier);
  const r = Math.min(1, max / Math.max(image.width, image.height));
  const toile = Object.assign(document.createElement("canvas"), { width: Math.round(image.width * r), height: Math.round(image.height * r) });
  toile.getContext("2d").drawImage(image, 0, 0, toile.width, toile.height);
  return toile.toDataURL("image/jpeg", 0.8);
}

async function charger() {
  const [meta, categories, locations, items, movements] = await Promise.all(
    ["meta", "categories", "locations", "items", "movements"].map(tout),
  );
  Object.assign(donnees, { profil: meta.find((m) => m.id === "profil") ?? null, categories, locations, items, movements });
  donnees.categories.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

const aller = (hash) => {
  if (location.hash === hash) afficher();
  else location.hash = hash;
};
const echec = (message) => {
  erreur = message;
  afficher();
  scrollTo(0, 0);
};

// ---------------------------------------------------------------- Écrans

const page = (titre, retour, corps) => `
  ${retour ? `<a class="retour no-print" href="${retour[0]}">← ${esc(retour[1])}</a>` : ""}
  ${titre ? `<h1>${esc(titre)}</h1>` : ""}
  ${erreur ? `<p class="erreur" role="alert">${esc(erreur)}</p>` : ""}
  ${corps}`;

function ecranBienvenue() {
  return page("Bienvenue", null, `
    <p>Inventaire QR fonctionne entièrement dans ce téléphone : pas de compte, pas d'ordinateur, et il marche même sans réseau.</p>
    <form class="carte" data-form="profil">
      <div class="champ"><label for="entreprise">Nom de votre entreprise</label><input id="entreprise" name="entreprise" required></div>
      <div class="champ"><label for="utilisateur">Votre nom</label><input id="utilisateur" name="utilisateur" required autocomplete="name"></div>
      <button class="btn">Commencer</button>
    </form>`);
}

function ecranAccueil() {
  const { items } = donnees;
  const compte = (e) => items.filter((i) => i.state === e).length;
  const valeur = items.reduce((s, i) => s + (i.value ?? 0) * i.quantity, 0);
  const jours = donnees.profil.derniereSauvegarde ? Math.floor((Date.now() - new Date(donnees.profil.derniereSauvegarde)) / 86400000) : null;
  const rappel = items.length > 0 && (jours === null || jours >= 14)
    ? `<p class="info">${jours === null ? "Aucune sauvegarde n'a encore été faite." : `Dernière sauvegarde il y a ${jours} jours.`} Vos données ne sont que dans ce téléphone : <a href="#/reglages">faites une sauvegarde</a>.</p>`
    : "";
  return page(null, null, `
    <p class="discret">Bonjour ${esc(donnees.profil.utilisateur)} — ${esc(donnees.profil.entreprise)}</p>
    ${rappel}
    <div class="grille">
      <a class="tuile principale large" href="#/scanner">Scanner<small>Lire un QR code</small></a>
      <a class="tuile" href="#/nouveau">Ajouter</a>
      <a class="tuile" href="#/articles">Recherche</a>
    </div>
    <h2 style="margin-top:24px">Tableau de bord</h2>
    <div class="grille">
      <a class="carte chiffre" href="#/articles"><span class="discret">Articles</span><b>${items.length}</b></a>
      <a class="carte chiffre" href="#/articles"><span class="discret">Valeur totale</span><b>${euros(valeur)}</b></a>
      <a class="carte chiffre" href="#/articles?etat=EN_MAINTENANCE"><span class="discret">En maintenance</span><b>${compte("EN_MAINTENANCE")}</b></a>
      <a class="carte chiffre" href="#/articles?etat=PRETE"><span class="discret">Prêtés</span><b>${compte("PRETE")}</b></a>
      <a class="carte chiffre" href="#/articles?etat=MANQUANT"><span class="discret">Manquants</span><b>${compte("MANQUANT")}</b></a>
    </div>`);
}

function ecranArticles(_, q) {
  const texte = (q.get("q") ?? "").trim().toLowerCase();
  const etat = q.get("etat") ?? "";
  const categorie = q.get("categorie") ?? "";
  const emplacement = q.get("emplacement") ?? "";
  const lieux = emplacements();
  const nomCategorie = new Map(donnees.categories.map((c) => [c.id, c.name]));

  const trouves = donnees.items
    .filter((i) => (!etat || i.state === etat) && (!categorie || i.categoryId === categorie) && (!emplacement || i.locationId === emplacement))
    .filter((i) => !texte || [i.name, i.reference, i.serialNumber, nomCategorie.get(i.categoryId), lieu(i.locationId, lieux)].some((v) => (v ?? "").toLowerCase().includes(texte)))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return page("Articles", ["#/", "Accueil"], `
    <form class="carte" data-form="recherche">
      <div class="champ"><input name="q" value="${esc(q.get("q") ?? "")}" placeholder="Nom, référence, n° de série…" aria-label="Recherche"></div>
      <div class="champ"><select name="categorie" aria-label="Catégorie">${options(donnees.categories.map((c) => [c.id, c.name]), categorie, "Toutes les catégories")}</select></div>
      <div class="champ"><select name="emplacement" aria-label="Emplacement">${options(lieux.map((e) => [e.id, e.chemin]), emplacement, "Tous les emplacements")}</select></div>
      <div class="champ"><select name="etat" aria-label="État">${options(Object.entries(ETATS), etat, "Tous les états")}</select></div>
      <button class="btn">Chercher</button>
    </form>
    <p class="discret">${trouves.length} article${trouves.length > 1 ? "s" : ""} · <a href="#/nouveau">+ Ajouter un article</a></p>
    ${trouves.length === 0 ? `<p class="carte">Aucun article trouvé.</p>` : trouves.map((a) => `
      <a class="carte article" href="#/article/${a.id}">
        <span><span class="nom">${esc(a.name)}</span><br><span class="discret">${esc([a.reference, nomCategorie.get(a.categoryId), a.locationId ? lieu(a.locationId, lieux) : null].filter(Boolean).join(" · ") || "—")}</span></span>
        <span class="droite"><span class="etat ${a.state}">${ETATS[a.state]}</span><br>${esc(quantite(a.quantity, a.unit))}</span>
      </a>`).join("")}`);
}

function formulaireArticle(a) {
  const lieux = emplacements();
  return `
    <form class="carte" data-form="article" data-id="${a?.id ?? ""}">
      <div class="champ"><label for="nom">Nom *</label><input id="nom" name="nom" required value="${esc(a?.name)}"></div>
      <div class="champ"><label for="reference">Référence</label><input id="reference" name="reference" value="${esc(a?.reference)}"></div>
      <div class="champ"><label for="numeroSerie">Numéro de série</label><input id="numeroSerie" name="numeroSerie" value="${esc(a?.serialNumber)}"></div>
      <div class="champ"><label for="categorie">Catégorie</label><select id="categorie" name="categorie">${options(donnees.categories.map((c) => [c.id, c.name]), a?.categoryId, "— Aucune —")}</select></div>
      <div class="champ"><label for="nouvelleCategorie">… ou nouvelle catégorie</label><input id="nouvelleCategorie" name="nouvelleCategorie" placeholder="Ex. Outillage"></div>
      <div class="champ"><label for="emplacement">Emplacement</label><select id="emplacement" name="emplacement">${options(lieux.map((e) => [e.id, e.chemin]), a?.locationId, "— Aucun —")}</select></div>
      <div class="champ"><label for="nouvelEmplacement">… ou nouvel emplacement</label><input id="nouvelEmplacement" name="nouvelEmplacement" placeholder="Ex. Fourgon, Caisse rouge"></div>
      <div class="grille">
        <div class="champ"><label for="quantite">Quantité</label><input id="quantite" name="quantite" inputmode="decimal" required value="${esc(a?.quantity ?? 1)}"></div>
        <div class="champ"><label for="unite">Unité</label><input id="unite" name="unite" required value="${esc(a?.unit ?? "pièce")}"></div>
      </div>
      <div class="champ"><label for="etat">État</label><select id="etat" name="etat">${options(Object.entries(ETATS), a?.state ?? "EN_STOCK")}</select></div>
      <div class="champ"><label for="valeur">Valeur unitaire (€)</label><input id="valeur" name="valeur" inputmode="decimal" value="${esc(a?.value)}"></div>
      <div class="champ"><label for="fournisseur">Fournisseur</label><input id="fournisseur" name="fournisseur" value="${esc(a?.supplier)}"></div>
      <div class="grille">
        <div class="champ"><label for="dateAchat">Date d'achat</label><input id="dateAchat" name="dateAchat" type="date" value="${esc(a?.purchaseDate)}"></div>
        <div class="champ"><label for="garantie">Fin de garantie</label><input id="garantie" name="garantie" type="date" value="${esc(a?.warrantyUntil)}"></div>
      </div>
      <div class="champ"><label for="photo">Photo${a?.hasPhoto ? " (en choisir une autre pour la remplacer)" : ""}</label><input id="photo" name="photo" type="file" accept="image/*" capture="environment"></div>
      <div class="champ"><label for="notes">Notes</label><textarea id="notes" name="notes" rows="3">${esc(a?.notes)}</textarea></div>
      <button class="btn">${a ? "Enregistrer" : "Créer l'article et son QR code"}</button>
    </form>`;
}

const ecranNouveau = () => page("Nouvel article", ["#/", "Accueil"], formulaireArticle(null));

function ecranModifier([aid]) {
  const a = donnees.items.find((i) => i.id === aid);
  if (!a) return ecranIntrouvable();
  return page(`Modifier — ${a.name}`, [`#/article/${a.id}`, "Fiche"], formulaireArticle(a) +
    `<button class="btn danger no-print" data-action="supprimer" data-id="${a.id}">Supprimer cet article</button>`);
}

const ecranIntrouvable = () =>
  page("Introuvable", ["#/", "Accueil"], `<div class="carte"><p>Cet article n'existe pas dans ce téléphone.</p><a class="btn" href="#/scanner">Scanner un QR code</a></div>`);

async function ecranFiche([aid]) {
  const a = donnees.items.find((i) => i.id === aid);
  if (!a) return ecranIntrouvable();
  const lieux = emplacements();
  const [qr, photo] = await Promise.all([imageQr(a.token), a.hasPhoto ? lire("photos", a.id) : null]);
  const lignes = [
    ["Référence", a.reference],
    ["État", ETATS[a.state]],
    ["Emplacement", lieu(a.locationId, lieux)],
    ["Quantité", quantite(a.quantity, a.unit)],
    ["Catégorie", donnees.categories.find((c) => c.id === a.categoryId)?.name],
    ["Numéro de série", a.serialNumber],
    ["Valeur unitaire", a.value != null ? euros(a.value) : null],
    ["Fournisseur", a.supplier],
    ["Date d'achat", jour(a.purchaseDate)],
    ["Fin de garantie", jour(a.warrantyUntil)],
    ["Notes", a.notes],
  ].filter(([, v]) => v);
  const historique = donnees.movements.filter((m) => m.itemId === a.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));

  return page(null, ["#/articles", "Articles"], `
    <div class="carte">
      <div class="entete-fiche">
        <div><div class="sur-titre">Article</div><h1 style="margin:0">${esc(a.name)}</h1></div>
        <span class="etat ${a.state}">${ETATS[a.state]}</span>
      </div>
      ${photo ? `<img class="photo" src="${photo.data}" alt="Photo de l'article">` : ""}
      <ul class="liste" style="margin-top:12px">${lignes.map(([k, v]) => `<li><span class="discret">${k}</span><span class="droite" style="flex-shrink:1;white-space:pre-line"><b>${esc(v)}</b></span></li>`).join("")}</ul>
    </div>
    <div class="grille" style="margin-bottom:14px">
      <a class="btn" href="#/mouvement/${a.id}?type=DEPLACEMENT">Déplacer</a>
      <a class="btn" href="#/mouvement/${a.id}?type=SORTIE">Ajouter mouvement</a>
      <a class="btn second" href="#/modifier/${a.id}">Modifier</a>
      <button class="btn second" data-action="voir-historique">Historique</button>
    </div>
    <div class="carte">
      <h2>QR code</h2>
      <img class="qr" src="${qr}" alt="QR code de l'article">
      <div class="grille">
        <a class="btn large" href="#/etiquette/${a.id}">Imprimer l'étiquette</a>
        <button class="btn second" data-action="qr-png" data-id="${a.id}">Image PNG</button>
        <button class="btn second" data-action="qr-svg" data-id="${a.id}">Image SVG</button>
      </div>
    </div>
    <div class="carte" id="historique">
      <h2>Historique</h2>
      <ol class="historique">${historique.map((m) => `
        <li><b>${MOUVEMENTS[m.type]}${m.quantity != null ? ` — ${esc(quantite(m.quantity, a.unit))}` : ""}${m.type === "DEPLACEMENT" ? ` — ${esc(lieu(m.fromLocationId, lieux))} → ${esc(lieu(m.toLocationId, lieux))}` : ""}</b>
        <span class="discret">${jourHeure(m.createdAt)} · ${esc(m.user)}${m.type !== "DEPLACEMENT" && m.toLocationId ? ` · ${esc(lieu(m.toLocationId, lieux))}` : ""}</span>
        ${m.comment ? `<br>${esc(m.comment)}` : ""}</li>`).join("")}</ol>
    </div>`);
}

function ecranMouvement([aid], q) {
  const a = donnees.items.find((i) => i.id === aid);
  if (!a) return ecranIntrouvable();
  const type = q.get("type") in MOUVEMENTS ? q.get("type") : "DEPLACEMENT";
  const lieux = emplacements();
  const autres = lieux.filter((e) => e.id !== a.locationId);
  return page(a.name, [`#/article/${a.id}`, "Fiche"], `
    <p>Actuellement : <b>${esc(lieu(a.locationId, lieux))}</b> · <b>${esc(quantite(a.quantity, a.unit))}</b></p>
    <form class="carte" data-form="mouvement" data-id="${a.id}">
      <div class="champ"><label for="type">Type de mouvement</label><select id="type" name="type" data-action="type-mouvement">${options(Object.entries(MOUVEMENTS), type)}</select></div>
      ${type === "DEPLACEMENT" ? `
        <div class="champ"><label for="emplacement">Nouvel emplacement</label><select id="emplacement" name="emplacement">${options(autres.map((e) => [e.id, e.chemin]), "", "Choisir…")}</select></div>
        <div class="champ"><label for="nouvelEmplacement">… ou nouvel emplacement</label><input id="nouvelEmplacement" name="nouvelEmplacement" placeholder="Ex. Chantier Dupont"></div>` : ""}
      ${AVEC_QUANTITE.includes(type) ? `<div class="champ"><label for="quantite">Quantité (${esc(a.unit)})</label><input id="quantite" name="quantite" inputmode="decimal" required value="1"></div>` : ""}
      <div class="champ"><label for="commentaire">Commentaire</label><textarea id="commentaire" name="commentaire" rows="2"></textarea></div>
      <button class="btn">Enregistrer le mouvement</button>
    </form>`);
}

async function ecranEtiquette([aid]) {
  const a = donnees.items.find((i) => i.id === aid);
  if (!a) return ecranIntrouvable();
  return `
    <div class="grille no-print" style="margin-bottom:18px">
      <a class="btn second" href="#/article/${a.id}">← Fiche</a>
      <button class="btn" data-action="imprimer">Imprimer</button>
    </div>
    <div class="etiquette">
      <img src="${await imageQr(a.token)}" alt="QR code">
      <b>${esc(a.name)}</b>
      ${a.reference ? `<span>Réf. ${esc(a.reference)}</span><br>` : ""}
      <span class="discret">${esc(donnees.profil.entreprise)}</span>
    </div>`;
}

function ecranScan([token]) {
  const a = donnees.items.find((i) => i.token === token);
  if (a) {
    // replace : le bouton « retour » ne doit pas revenir sur l'adresse du QR.
    location.replace(`#/article/${a.id}`);
    return "";
  }
  return page("QR code inconnu", ["#/", "Accueil"], `<div class="carte"><p>Ce QR code ne correspond à aucun article enregistré dans ce téléphone.</p><a class="btn" href="#/scanner">Scanner un autre QR code</a></div>`);
}

function ecranScanner() {
  return page("Scanner", ["#/", "Accueil"], `
    <div class="cadre-video"><video id="video" playsinline muted hidden></video><p id="etat-scan" role="status">Démarrage de la caméra…</p></div>
    <form class="carte" data-form="recherche">
      <div class="champ"><label for="q">QR illisible ? Cherchez l'article</label><input id="q" name="q" placeholder="Nom, référence, n° de série…"></div>
      <button class="btn second">Chercher</button>
    </form>`);
}

/** Le lecteur de QR est gros : on ne le charge qu'à l'ouverture du scanner. */
let chargementLecteur;
function lecteurQr() {
  chargementLecteur ??= new Promise((ok, ko) => {
    const s = Object.assign(document.createElement("script"), { src: "lib/jsQR.js", onload: ok });
    s.onerror = () => {
      chargementLecteur = undefined;
      s.remove();
      ko(new Error("jsQR"));
    };
    document.head.append(s);
  });
  return chargementLecteur;
}

async function demarrerScanner() {
  const video = document.getElementById("video");
  const message = document.getElementById("etat-scan");
  let flux = null;
  let boucle = 0;
  let arrete = false;
  arreterCamera = () => {
    arrete = true;
    cancelAnimationFrame(boucle);
    flux?.getTracks().forEach((t) => t.stop());
  };
  if (!navigator.mediaDevices?.getUserMedia) {
    message.textContent = "La caméra n'est pas disponible ici. Cherchez l'article ci-dessous.";
    return;
  }
  try {
    await lecteurQr();
  } catch {
    message.textContent = "Le lecteur de QR code n'a pas pu se charger. Réessayez avec du réseau.";
    return;
  }
  try {
    flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch {
    message.textContent = "Caméra refusée ou introuvable. Autorisez la caméra, ou cherchez l'article ci-dessous.";
    return;
  }
  if (arrete) return flux.getTracks().forEach((t) => t.stop());
  video.srcObject = flux;
  video.hidden = false;
  await video.play();
  message.textContent = "Visez le QR code de l'étiquette.";

  const toile = document.createElement("canvas");
  const ctx = toile.getContext("2d", { willReadFrequently: true });
  const lireImage = () => {
    if (arrete) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      toile.width = video.videoWidth;
      toile.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const image = ctx.getImageData(0, 0, toile.width, toile.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (code?.data) {
        // On ne retient que le jeton : aucun autre lien n'est suivi.
        const m = code.data.trim().match(/#\/q\/([A-Za-z0-9_-]{16,64})$/);
        if (m) return aller(`#/q/${m[1]}`);
        message.textContent = "Ce QR code n'est pas une étiquette Inventaire QR.";
      }
    }
    boucle = requestAnimationFrame(lireImage);
  };
  boucle = requestAnimationFrame(lireImage);
}

function ecranReglages() {
  const lieux = emplacements();
  const nb = (cle, v) => donnees.items.filter((i) => i[cle] === v).length;
  const sauvegarde = donnees.profil.derniereSauvegarde ? `Dernière sauvegarde : ${jourHeure(donnees.profil.derniereSauvegarde)}.` : "Aucune sauvegarde pour l'instant.";
  return page("Réglages", ["#/", "Accueil"], `
    <div class="carte">
      <h2>Sauvegarde</h2>
      <p>Vos données sont <b>uniquement dans ce téléphone</b>. Si le téléphone est perdu, cassé, ou si les données du navigateur sont effacées, tout est perdu — sauf si vous avez une sauvegarde.</p>
      <p class="discret">${sauvegarde}</p>
      <div class="champ"><button class="btn" data-action="sauvegarder">Faire une sauvegarde</button></div>
      <p class="discret">Le fichier se range dans les téléchargements : envoyez-le-vous par e-mail ou gardez-le ailleurs que sur ce téléphone.</p>
      <div class="champ"><label for="restaurer">Reprendre une sauvegarde (remplace tout)</label><input id="restaurer" type="file" accept="application/json,.json" data-action="restaurer"></div>
      <button class="btn second" data-action="export-csv">Exporter les articles (tableur CSV)</button>
    </div>
    <div class="carte">
      <h2>Catégories</h2>
      ${donnees.categories.length ? `<ul class="liste">${donnees.categories.map((c) => `<li><span>${esc(c.name)}</span><span class="discret">${nb("categoryId", c.id)} article(s)</span></li>`).join("")}</ul>` : `<p class="discret">Aucune catégorie.</p>`}
      <form class="ligne-ajout" data-form="categorie" style="margin-top:10px"><input name="nom" required placeholder="Nouvelle catégorie" aria-label="Nouvelle catégorie"><button class="btn">Ajouter</button></form>
    </div>
    <div class="carte">
      <h2>Emplacements</h2>
      <p class="discret">Exemples : Fourgon, Fourgon → Étagère 2, Garage, Chantier Dupont.</p>
      ${lieux.length ? `<ul class="liste">${lieux.map((e) => `<li><span>${esc(e.chemin)}</span><span class="discret">${nb("locationId", e.id)} article(s)</span></li>`).join("")}</ul>` : `<p class="discret">Aucun emplacement.</p>`}
      <form data-form="emplacement" style="margin-top:10px">
        <div class="champ"><label for="nomEmplacement">Nom</label><input id="nomEmplacement" name="nom" required></div>
        <div class="champ"><label for="parent">Situé dans</label><select id="parent" name="parent">${options(lieux.map((e) => [e.id, e.chemin]), "", "— Rien (niveau le plus haut) —")}</select></div>
        <button class="btn">Ajouter l'emplacement</button>
      </form>
    </div>
    <form class="carte" data-form="profil">
      <h2>Entreprise</h2>
      <div class="champ"><label for="entreprise">Nom de l'entreprise</label><input id="entreprise" name="entreprise" required value="${esc(donnees.profil.entreprise)}"></div>
      <div class="champ"><label for="utilisateur">Votre nom</label><input id="utilisateur" name="utilisateur" required value="${esc(donnees.profil.utilisateur)}"></div>
      <button class="btn second">Enregistrer</button>
    </form>
    <div class="carte">
      <h2>Mettre sur l'écran d'accueil</h2>
      ${invitationInstallation ? `<button class="btn" data-action="installer">Installer l'application</button>` : `<p class="discret">Android (Chrome) : menu ⋮ puis « Ajouter à l'écran d'accueil ». iPhone (Safari) : bouton Partager puis « Sur l'écran d'accueil ».</p>`}
    </div>`);
}

// ---------------------------------------------------------------- Enregistrements

/** Renvoie l'identifiant choisi dans la liste, ou crée la catégorie / l'emplacement saisi à la volée. */
function choisirOuCreer(table, liste, choisi, nouveau, lignes) {
  const nom = (nouveau ?? "").trim().slice(0, 80);
  if (!nom) return choisi || null;
  const existant = liste.find((x) => x.name.toLowerCase() === nom.toLowerCase() && !x.parentId);
  if (existant) return existant.id;
  const valeur = table === "locations" ? { id: id(), name: nom, parentId: null } : { id: id(), name: nom };
  lignes.push({ table, valeur });
  return valeur.id;
}

const mouvement = (item, type, champs = {}) => ({
  id: id(),
  itemId: item.id,
  type,
  quantity: null,
  fromLocationId: item.locationId,
  toLocationId: item.locationId,
  comment: null,
  user: donnees.profil.utilisateur,
  createdAt: new Date().toISOString(),
  ...champs,
});

const formulaires = {
  async profil(f) {
    const entreprise = f.get("entreprise").trim();
    const utilisateur = f.get("utilisateur").trim();
    if (!entreprise || !utilisateur) return echec("Remplissez les deux champs.");
    await ecrire([{ table: "meta", valeur: { ...donnees.profil, id: "profil", entreprise, utilisateur } }]);
    // Demande au téléphone de ne pas effacer les données quand la mémoire est pleine.
    navigator.storage?.persist?.();
    await charger();
    aller("#/");
  },

  recherche(f) {
    const q = new URLSearchParams([...f.entries()].filter(([, v]) => v));
    aller(`#/articles${q.size ? `?${q}` : ""}`);
  },

  async categorie(f) {
    const lignes = [];
    choisirOuCreer("categories", donnees.categories, null, f.get("nom"), lignes);
    if (lignes.length) await ecrire(lignes);
    await charger();
    afficher();
  },

  async emplacement(f) {
    const name = f.get("nom").trim().slice(0, 80);
    if (!name) return echec("Donnez un nom à l'emplacement.");
    await ecrire([{ table: "locations", valeur: { id: id(), name, parentId: f.get("parent") || null } }]);
    await charger();
    afficher();
  },

  async article(f, form) {
    const ancien = donnees.items.find((i) => i.id === form.dataset.id);
    const name = f.get("nom").trim();
    const qte = nombre(f.get("quantite"));
    const valeur = nombre(f.get("valeur"));
    if (!name) return echec("Le nom est obligatoire.");
    if (qte === null || qte < 0) return echec("Quantité invalide.");
    if (f.get("valeur").trim() !== "" && (valeur === null || valeur < 0)) return echec("Valeur invalide.");

    const lignes = [];
    const item = {
      id: ancien?.id ?? id(),
      token: ancien?.token ?? jeton(),
      createdAt: ancien?.createdAt ?? new Date().toISOString(),
      hasPhoto: ancien?.hasPhoto ?? false,
      name: name.slice(0, 160),
      reference: f.get("reference").trim() || null,
      serialNumber: f.get("numeroSerie").trim() || null,
      categoryId: choisirOuCreer("categories", donnees.categories, f.get("categorie"), f.get("nouvelleCategorie"), lignes),
      locationId: choisirOuCreer("locations", donnees.locations, f.get("emplacement"), f.get("nouvelEmplacement"), lignes),
      quantity: qte,
      unit: f.get("unite").trim() || "pièce",
      state: f.get("etat") in ETATS ? f.get("etat") : "EN_STOCK",
      value: valeur,
      supplier: f.get("fournisseur").trim() || null,
      purchaseDate: f.get("dateAchat") || null,
      warrantyUntil: f.get("garantie") || null,
      notes: f.get("notes").trim() || null,
    };

    const photo = f.get("photo");
    if (photo instanceof File && photo.size > 0) {
      try {
        lignes.push({ table: "photos", valeur: { id: item.id, data: await reduirePhoto(photo) } });
        item.hasPhoto = true;
      } catch {
        return echec("Cette photo n'a pas pu être lue. Essayez-en une autre.");
      }
    }

    lignes.push({ table: "items", valeur: item });
    if (!ancien) {
      lignes.push({ table: "movements", valeur: mouvement(item, "ENTREE", { quantity: qte, fromLocationId: null, comment: "Création de l'article" }) });
    } else if (ancien.locationId !== item.locationId) {
      // Un changement d'emplacement fait depuis la fiche reste tracé dans l'historique.
      lignes.push({ table: "movements", valeur: mouvement(item, "DEPLACEMENT", { fromLocationId: ancien.locationId, comment: "Modification de la fiche" }) });
    }
    await ecrire(lignes);
    await charger();
    aller(`#/article/${item.id}`);
  },

  async mouvement(f, form) {
    const a = donnees.items.find((i) => i.id === form.dataset.id);
    const type = f.get("type");
    if (!a || !(type in MOUVEMENTS)) return echec("Mouvement invalide.");
    const lignes = [];
    const maj = { ...a };
    const champs = { comment: (f.get("commentaire") ?? "").trim() || null };

    if (AVEC_QUANTITE.includes(type)) {
      const qte = nombre(f.get("quantite"));
      if (qte === null || qte <= 0) return echec("Indiquez une quantité supérieure à zéro.");
      if (type === "ENTREE") maj.quantity = a.quantity + qte;
      else {
        if (qte > a.quantity) return echec(`Quantité trop grande : il n'en reste que ${quantite(a.quantity, a.unit)}.`);
        maj.quantity = a.quantity - qte;
        if (maj.quantity === 0 && type === "PERTE") maj.state = "MANQUANT";
        if (maj.quantity === 0 && type === "REBUT") maj.state = "HORS_SERVICE";
      }
      // Évite les 0,30000000000000004 des calculs à virgule.
      maj.quantity = Math.round(maj.quantity * 100) / 100;
      champs.quantity = qte;
    }
    if (type === "DEPLACEMENT") {
      const destination = choisirOuCreer("locations", donnees.locations, f.get("emplacement"), f.get("nouvelEmplacement"), lignes);
      if (!destination) return echec("Choisissez le nouvel emplacement.");
      if (destination === a.locationId) return echec("L'article est déjà à cet emplacement.");
      maj.locationId = destination;
      champs.toLocationId = destination;
    }
    if (type === "PRET") maj.state = "PRETE";
    if (type === "RETOUR") maj.state = "EN_STOCK";
    if (type === "MAINTENANCE") maj.state = "EN_MAINTENANCE";

    lignes.push({ table: "items", valeur: maj }, { table: "movements", valeur: mouvement(a, type, champs) });
    await ecrire(lignes);
    await charger();
    aller(`#/article/${a.id}`);
  },
};

const actions = {
  imprimer: () => print(),
  "voir-historique": () => document.getElementById("historique")?.scrollIntoView({ behavior: "smooth" }),
  "type-mouvement": (el) => aller(`${location.hash.split("?")[0]}?type=${el.value}`),

  async "qr-png"(el) {
    const a = donnees.items.find((i) => i.id === el.dataset.id);
    telecharger(`qr-${(a.reference || a.name).replace(/[^\w-]+/g, "_")}.png`, await imageQr(a.token));
  },
  async "qr-svg"(el) {
    const a = donnees.items.find((i) => i.id === el.dataset.id);
    const svg = await QRCode.toString(lienQr(a.token), { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    telecharger(`qr-${(a.reference || a.name).replace(/[^\w-]+/g, "_")}.svg`, svg, "image/svg+xml");
  },

  async supprimer(el) {
    const a = donnees.items.find((i) => i.id === el.dataset.id);
    if (!a || !confirm(`Supprimer définitivement « ${a.name} » et son historique ?`)) return;
    await ecrire([
      { table: "items", supprimer: a.id },
      { table: "photos", supprimer: a.id },
      ...donnees.movements.filter((m) => m.itemId === a.id).map((m) => ({ table: "movements", supprimer: m.id })),
    ]);
    await charger();
    aller("#/articles");
  },

  async sauvegarder() {
    const contenu = { application: "inventaire-qr", version: 1, date: new Date().toISOString() };
    for (const t of TABLES) contenu[t] = await tout(t);
    telecharger(`inventaire-qr-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(contenu), "application/json");
    await ecrire([{ table: "meta", valeur: { ...donnees.profil, derniereSauvegarde: contenu.date } }]);
    await charger();
    afficher();
  },

  async restaurer(el) {
    const fichier = el.files?.[0];
    if (!fichier) return;
    let contenu;
    try {
      contenu = JSON.parse(await fichier.text());
    } catch {
      return echec("Ce fichier n'est pas une sauvegarde Inventaire QR.");
    }
    if (contenu?.application !== "inventaire-qr" || !Array.isArray(contenu.items)) return echec("Ce fichier n'est pas une sauvegarde Inventaire QR.");
    if (!confirm(`Remplacer tout le contenu de ce téléphone par la sauvegarde du ${jourHeure(contenu.date)} (${contenu.items.length} articles) ?`)) return afficher();
    await remplacerTout(contenu);
    await charger();
    aller("#/");
  },

  "export-csv"() {
    const lieux = emplacements();
    const cellule = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lignes = [
      ["Nom", "Référence", "Catégorie", "Numéro de série", "Quantité", "Unité", "État", "Valeur", "Fournisseur", "Date achat", "Garantie", "Emplacement", "Notes"],
      ...donnees.items.map((i) => [
        i.name, i.reference, donnees.categories.find((c) => c.id === i.categoryId)?.name, i.serialNumber,
        String(i.quantity).replace(".", ","), i.unit, ETATS[i.state], i.value != null ? String(i.value).replace(".", ",") : "",
        i.supplier, jour(i.purchaseDate), jour(i.warrantyUntil), i.locationId ? lieu(i.locationId, lieux) : "", i.notes,
      ]),
    ];
    // Point-virgule et marqueur UTF-8 : s'ouvre directement dans Excel en français.
    telecharger("inventaire-qr-articles.csv", "﻿" + lignes.map((l) => l.map(cellule).join(";")).join("\r\n"), "text/csv");
  },

  async installer() {
    await invitationInstallation?.prompt();
    invitationInstallation = null;
    afficher();
  },
};

// ---------------------------------------------------------------- Navigation

const ROUTES = [
  [/^\/?$/, ecranAccueil],
  [/^\/articles$/, ecranArticles],
  [/^\/nouveau$/, ecranNouveau],
  [/^\/article\/([\w-]+)$/, ecranFiche],
  [/^\/modifier\/([\w-]+)$/, ecranModifier],
  [/^\/mouvement\/([\w-]+)$/, ecranMouvement],
  [/^\/etiquette\/([\w-]+)$/, ecranEtiquette],
  [/^\/q\/([\w-]+)$/, ecranScan],
  [/^\/scanner$/, ecranScanner],
  [/^\/reglages$/, ecranReglages],
];

let rendu = 0;
async function afficher() {
  const numero = ++rendu;
  arreterCamera?.();
  arreterCamera = null;
  const [chemin, requete = ""] = location.hash.replace(/^#/, "").split("?");
  let html;
  if (!donnees.profil) html = ecranBienvenue();
  else {
    const route = ROUTES.map(([re, vue]) => [chemin.match(re), vue]).find(([m]) => m);
    html = route ? await route[1](route[0].slice(1), new URLSearchParams(requete)) : ecranIntrouvable();
  }
  // Un autre écran a été demandé pendant la préparation de celui-ci.
  if (numero !== rendu) return;
  erreur = "";
  app.innerHTML = html;
  if (donnees.profil && chemin === "/scanner") demarrerScanner();
}

addEventListener("hashchange", () => {
  afficher();
  scrollTo(0, 0);
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  try {
    await formulaires[form.dataset.form](new FormData(form), form);
  } catch (err) {
    console.error(err);
    echec("L'enregistrement a échoué. Vérifiez la place disponible sur le téléphone.");
  }
});

const declencher = async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  // Les listes et les fichiers réagissent au changement, les boutons au clic.
  const champ = el.matches("select, input");
  if ((e.type === "change") !== champ) return;
  try {
    await actions[el.dataset.action](el);
  } catch (err) {
    console.error(err);
    echec("L'opération a échoué.");
  }
};
document.addEventListener("click", declencher);
document.addEventListener("change", declencher);

addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  invitationInstallation = e;
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

charger().then(afficher, (err) => {
  console.error(err);
  app.innerHTML = `<p class="erreur">Ce navigateur ne permet pas d'enregistrer des données (navigation privée ?). Ouvrez l'application dans Chrome ou Safari, hors navigation privée.</p>`;
});
