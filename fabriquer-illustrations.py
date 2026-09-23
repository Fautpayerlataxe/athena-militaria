#!/usr/bin/env python3
"""Illustrations des guides : téléchargement depuis Wikimedia Commons et
préparation des trois formats servis.

Pourquoi : aucun guide n'avait d'image propre. Tous partageaient og-cover.jpg,
y compris dans leurs données structurées. Sans image pertinente, une page ne
peut ni recevoir de vignette dans les résultats mobiles, ni être trouvée par
Google Images ou Lens, ni figurer dans Discover.

Entrée : guides-illustrations.json (choix du fichier, légendes, crédits).
Sortie, dans guides/img/ :
  <slug>-760.webp   affichage dans la page
  <slug>-1200.webp  écrans denses, et image déclarée aux moteurs
  <slug>-og.jpg     1200 x 630, partage et données structurées
  manifeste.json    dimensions, page source et licence, lus par build-guides.cjs

Les licences sont relues à chaque passage sur Commons, jamais recopiées à la
main : si un fichier change de licence ou disparaît, le script s'arrête.

Usage : python3 fabriquer-illustrations.py
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

RACINE = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(RACINE, "guides", "img")
CACHE = os.path.join(RACINE, ".cache", "illustrations")
UA = {"User-Agent": "AthenaMilitariaGuides/1.0 (https://www.athenamilitaria.fr; contact@athenamilitaria.fr)"}
# Licences acceptées : celles qui autorisent la réutilisation commerciale.
LIBRE = re.compile(r"^(Public domain|PD\b|CC0|CC BY(-SA)? \d\.\d)", re.I)
FOND = (241, 236, 226)  # papier du site, derrière les pièces en format portrait


def api(titres):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "titles": "|".join(titres), "prop": "imageinfo",
        "iiprop": "url|size|extmetadata", "iiurlwidth": 1600,
        "format": "json", "formatversion": 2})
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return {p["title"]: p for p in json.load(r)["query"]["pages"]}


def telecharger(url, nom):
    os.makedirs(CACHE, exist_ok=True)
    chemin = os.path.join(CACHE, nom)
    if not os.path.exists(chemin):
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            open(chemin, "wb").write(r.read())
    return chemin


def ajuster(im, largeur, hauteur):
    im = im.copy()
    im.thumbnail((largeur, hauteur), Image.LANCZOS)
    return im


def main():
    choix = json.load(open(os.path.join(RACINE, "guides-illustrations.json"), encoding="utf-8"))
    choix = {k: v for k, v in choix.items() if not k.startswith("_")}
    pages = api([c["fichier"] for c in choix.values()])
    os.makedirs(SORTIE, exist_ok=True)
    manifeste = {}
    for slug, c in choix.items():
        p = pages.get(c["fichier"])
        if not p or "imageinfo" not in p:
            sys.exit(f"Introuvable sur Commons : {c['fichier']}")
        ii = p["imageinfo"][0]
        m = ii.get("extmetadata", {})
        licence = m.get("LicenseShortName", {}).get("value", "")
        if not LIBRE.search(licence):
            sys.exit(f"Licence non libre pour {slug} : {licence!r}")
        source = ii.get("thumburl") or ii["url"]
        ext = os.path.splitext(urllib.parse.urlparse(source).path)[1].lower() or ".jpg"
        im = Image.open(telecharger(source, slug + ext))
        im = ImageOps.exif_transpose(im)
        if im.mode != "RGB":
            fond = Image.new("RGB", im.size, FOND)
            fond.paste(im, mask=im.convert("RGBA").split()[-1])
            im = fond

        petite = ajuster(im, 760, 520)
        grande = ajuster(im, 1200, 820)
        # Une photo très texturée (un grillage, du gravier) pèse le double d'une
        # pièce sur fond uni à qualité égale : on redescend jusqu'à tenir le
        # budget de la page, 90 Ko pour l'image affichée.
        for qualite in (80, 72, 64, 56):
            petite.save(os.path.join(SORTIE, f"{slug}-760.webp"), "WEBP", quality=qualite, method=6)
            if os.path.getsize(os.path.join(SORTIE, f"{slug}-760.webp")) <= 90 * 1024:
                break
        grande.save(os.path.join(SORTIE, f"{slug}-1200.webp"), "WEBP", quality=qualite, method=6)

        # Format de partage : la pièce entière sur fond papier, jamais rognée.
        # Une médaille coupée à mi-hauteur dans un aperçu ne ressemble à rien.
        og = Image.new("RGB", (1200, 630), FOND)
        dedans = ajuster(im, 1140, 590)
        og.paste(dedans, ((1200 - dedans.width) // 2, (630 - dedans.height) // 2))
        og.save(os.path.join(SORTIE, f"{slug}-og.jpg"), "JPEG", quality=84, optimize=True, progressive=True)

        manifeste[slug] = {
            "fichier": c["fichier"],
            "page": ii["descriptionurl"],
            "licence": licence,
            "licenceUrl": m.get("LicenseUrl", {}).get("value", ""),
            "l760": [petite.width, petite.height],
            "l1200": [grande.width, grande.height],
        }
        poids = sum(os.path.getsize(os.path.join(SORTIE, f"{slug}{s}")) for s in ("-760.webp", "-1200.webp", "-og.jpg"))
        print(f"   {slug:42} {licence:18} {petite.width}x{petite.height}  {poids // 1024} Ko")

    with open(os.path.join(SORTIE, "manifeste.json"), "w", encoding="utf-8") as f:
        json.dump(manifeste, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"   {len(manifeste)} illustration(s) dans guides/img/")


if __name__ == "__main__":
    main()
