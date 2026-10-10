#!/usr/bin/env python3
"""Avant chaque déploiement (après les builds) : pour chaque ressource servie
en cache « immutable » (?v=), compare
le fichier local (après build) au fichier en ligne ; s'il diffère, passe le
numéro au-dessus du plus grand des deux (local, en ligne) dans tous les
gabarits HTML. i18n-en.js n'apparaît pas dans les gabarits (chargé par le
moteur) : il suit le numéro d'i18n-fr.js via i18n-runtime, voir plus bas."""
import glob, re, subprocess, sys, urllib.request, os

RACINE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.dirname(os.path.abspath(__file__))
os.chdir(RACINE)
gabarits = glob.glob('*.html')
ressources = {}
for g in gabarits:
    for m in re.finditer(r'(?:src|href)="/?([A-Za-z0-9_./-]+\.(?:js|css))\?v=(\d+)"', open(g, encoding='utf-8').read()):
        ressources.setdefault(m.group(1), set()).add(int(m.group(2)))

accueil = urllib.request.urlopen('https://www.athenamilitaria.fr/annonce/casque-us-tankiste-ww2-28', timeout=30).read().decode('utf-8', 'replace')
accueil += urllib.request.urlopen('https://www.athenamilitaria.fr/', timeout=30).read().decode('utf-8', 'replace')

changements = {}
for f, vs in sorted(ressources.items()):
    local_v = max(vs)
    m = re.search(r'(?<![A-Za-z0-9_.-])' + re.escape(f) + r'\?v=(\d+)', accueil)
    ligne_v = int(m.group(1)) if m else local_v
    try:
        distant = urllib.request.urlopen(f'https://www.athenamilitaria.fr/{f}?v={ligne_v}&nc=1', timeout=30).read()
    except Exception as e:
        distant = b''
    local = open(f, 'rb').read() if os.path.exists(f) else b''
    differe = local != distant
    nouveau = max(local_v, ligne_v) + 1 if differe else max(local_v, ligne_v)
    if nouveau != local_v:
        changements[f] = (local_v, ligne_v, nouveau, differe)
    print(f'{f:28s} local={local_v:4d} en_ligne={ligne_v:4d} differe={differe!s:5s} -> {nouveau}')

# Les tables de langue : i18n-en.js prend le numéro d'i18n-fr.js côté serveur,
# et le numéro d'i18n-runtime.js quand le moteur la télécharge à la demande
# (versionRessources lit le premier script « i18n- » de la page). Si l'une des
# trois a changé, les deux numéros montent.
def differe_en_ligne(f, v):
    try:
        d = urllib.request.urlopen(f'https://www.athenamilitaria.fr/{f}?v={v}&nc=1', timeout=30).read()
    except Exception:
        d = b''
    return open(f, 'rb').read() != d
vr = max(ressources.get('i18n-runtime.js', {0}))
vf = max(ressources.get('i18n-fr.js', {0}))
if any([differe_en_ligne('i18n-runtime.js', vr), differe_en_ligne('i18n-fr.js', vf), differe_en_ligne('i18n-en.js', vf)]):
    for f, v in (('i18n-runtime.js', vr), ('i18n-fr.js', vf)):
        if f not in changements:
            changements[f] = (v, v, v + 1, True)
    print('tables de langue : numéros montés', changements['i18n-runtime.js'][2], changements['i18n-fr.js'][2])

if '--appliquer' in sys.argv:
    for g in gabarits:
        t = open(g, encoding='utf-8').read()
        t2 = t
        for f, (lv, _, nv, _) in changements.items():
            t2 = re.sub(r'(?<![A-Za-z0-9_.-])(' + re.escape(f) + r')\?v=\d+', r'\1?v=' + str(nv), t2)
        if t2 != t:
            open(g, 'w', encoding='utf-8').write(t2)
    print('appliqué :', {f: c[2] for f, c in changements.items()})
