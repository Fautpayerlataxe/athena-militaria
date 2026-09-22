"""Audit SEO de toutes les adresses annoncées par les plans de site.

Chaque page est lue comme un moteur la reçoit : sans JavaScript, avec l'agent
de Googlebot. Les défauts de balises ne se voient jamais dans un navigateur,
et Search Console ne les remonte qu'avec des semaines de retard.

Usage : python3 audit-seo.py
"""
import re, json, urllib.request, urllib.error, concurrent.futures
from collections import defaultdict

BASE = "https://www.athenamilitaria.fr"
UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
FICHIER = re.compile(r"\.(png|ico|css|js|webmanifest|webp|jpe?g|xml)")


def lire(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    try:
        r = urllib.request.urlopen(req, timeout=40)
        return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)


def collecter():
    out, vus = [], set()
    for sm in ["/sitemap-pages.xml", "/sitemap-annonces.xml"]:
        _, xml = lire(BASE + sm)
        for u in re.findall(r"<loc>([^<]+)</loc>", xml):
            u = u.replace("&amp;", "&")
            if u.endswith(".xml") or u in vus:
                continue
            vus.add(u)
            out.append(u)
    return out


def balise(h, motif):
    r = re.search(motif, h, re.I)
    return r.group(1).strip() if r else None


def jsonld(h):
    noeuds = []
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>([\s\S]*?)</script>', h):
        try:
            d = json.loads(m.group(1))
        except Exception:
            noeuds.append({"@type": "ILLISIBLE"})
            continue
        noeuds.extend(d.get("@graph", [d]))
    return noeuds


def controler(url):
    pbs = []
    code, h = lire(url)
    if code != 200:
        return url, [f"code {code}"], {}
    titre = balise(h, r"<title>([\s\S]*?)</title>")
    desc = balise(h, r'<meta name="description" content="([^"]*)"')
    canon = balise(h, r'<link rel="canonical" href="([^"]*)"')
    robots = balise(h, r'<meta name="robots" content="([^"]*)"') or "index"
    lang = balise(h, r'<html lang="([^"]*)"')
    h1 = re.findall(r"<h1[^>]*>([\s\S]*?)</h1>", h)
    alts = dict(re.findall(r'<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"', h))
    og = dict(re.findall(r'<meta property="(og:[^"]*)" content="([^"]*)"', h))
    types = [n.get("@type") for n in jsonld(h)]
    anglaise = "lang=en" in url

    # Une page annoncée par le plan de site doit être indexable : sinon le
    # plan de site contredit la page, et Google finit par se méfier des deux.
    if "noindex" in robots:
        pbs.append("noindex alors qu'elle est dans un plan de site")
    if not titre:
        pbs.append("titre absent")
    elif len(titre) > 65:
        pbs.append(f"titre {len(titre)} car.")
    if not desc:
        pbs.append("description absente")
    elif not (110 <= len(desc) <= 165):
        pbs.append(f"description {len(desc)} car.")
    if not canon:
        pbs.append("canonique absente")
    elif canon != url:
        pbs.append(f"canonique != url ({canon})")
    if len(h1) != 1:
        pbs.append(f"{len(h1)} h1")
    attendu = "en" if anglaise or "/en/" in url else "fr"
    if lang != attendu:
        pbs.append(f"html lang={lang} au lieu de {attendu}")
    if alts:
        if "x-default" not in alts:
            pbs.append("x-default absent")
        for k in ("fr", "en"):
            if k not in alts:
                pbs.append(f"hreflang {k} absent")
    if "og:title" not in og:
        pbs.append("og:title absent")
    if "og:image" not in og:
        pbs.append("og:image absent")
    if "ILLISIBLE" in types:
        pbs.append("JSON-LD illisible")
    if not types:
        pbs.append("aucune donnée structurée")
    # Maillage : une page anglaise ne doit renvoyer que vers l'anglais.
    liens = [l for l in re.findall(r'href="(/[^"]*)"', h) if not FICHIER.search(l)]
    if anglaise and liens:
        fr = [l for l in liens if "lang=en" not in l]
        if fr:
            pbs.append(f"{len(fr)} lien(s) vers le français : {fr[:3]}")
    return url, pbs, {"titre": titre, "desc": desc, "robots": robots, "alts": alts}


def principal():
    urls = collecter()
    print(f"{len(urls)} adresses annoncées par les plans de site\n")
    res = {}
    with concurrent.futures.ThreadPoolExecutor(6) as ex:
        for url, pbs, info in ex.map(controler, urls):
            res[url] = (pbs, info)

    nb = 0
    for url in urls:
        pbs, _ = res[url]
        if pbs:
            nb += 1
            print("!! " + url.replace(BASE, ""))
            for p in pbs:
                print("     - " + p)
    print(f"\n{nb} page(s) avec au moins un signalement sur {len(urls)}\n")

    print("== réciprocité hreflang ==")
    man = 0
    for url in urls:
        _, info = res[url]
        for hl, cible in (info.get("alts") or {}).items():
            if hl == "x-default":
                continue
            if cible not in res:
                print(f"   {url.replace(BASE, '')} -> {hl} absent des plans de site")
                man += 1
            elif (res[cible][1].get("alts") or {}).get(hl) != cible:
                print(f"   {url.replace(BASE, '')} -> {cible.replace(BASE, '')} non réciproque")
                man += 1
    print(f"   {man} anomalie(s)\n")

    print("== titres et descriptions en double ==")
    pt, pd = defaultdict(list), defaultdict(list)
    for url in urls:
        _, i = res[url]
        if i.get("titre"):
            pt[i["titre"]].append(url)
        if i.get("desc"):
            pd[i["desc"]].append(url)
    doublons = 0
    for t, l in pt.items():
        if len(l) > 1:
            print(f"   titre partagé par {len(l)} pages : {t[:60]}")
            doublons += 1
    for d, l in pd.items():
        if len(l) > 1:
            print(f"   description partagée par {len(l)} pages : {d[:60]}")
            doublons += 1
    if not doublons:
        print("   aucun")


if __name__ == "__main__":
    principal()
