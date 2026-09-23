"""
Saca los polígonos de suertes de un plano GeoPDF del ingenio (23-sep-2026).

Así se ubicó RIOGRANDE II (hacienda 627, Ingenio Risaralda) en el mapa de la
finca: el «PLANO GENERAL_2025.pdf» es VECTORIAL y trae su georreferencia
(/VP → /Measure → /GPTS + /LPTS + EPSG 3115, MAGNA-SIRGAS Oeste).

Uso:
    python scripts/geopdf-poligonos.py PLANO.pdf x0 y0 x1 y1 salida.json

(x0 y0 x1 y1) es el recuadro de la hacienda en coordenadas de la página del PDF
(origen arriba a la izquierda, como las reporta PyMuPDF). Para encontrarlo:
renderizar la página en baja resolución, ubicar el rótulo de la hacienda y
acercar. Los rótulos NO son texto (vienen como dibujos): el número de cada
suerte se reconoce por la cantidad de puntos del glifo — en el plano de
Risaralda 2025: 24→1, 56→2, 92→3, 28→4, 66→5, 80→6 (verificar en cada plano).

Salida: lista de {etiqueta, area_ha, anillo:[[lng,lat],…]} lista para
`af_guardar_poligonos` (o para un INSERT en af_poligonos).

⚠️ El plano puede ser más viejo que las suertes de hoy (en Riogrande II el plano
es de 2025 y en julio de 2026 aparecieron 2A, 3A, 4A y 5B). Por eso los pedazos
se cargan con el número del plano y administración los asigna en la app.
Requiere: pymupdf, pyproj, numpy.
"""
import json
import re
import sys

import numpy as np
import pymupdf
from pyproj import Transformer

DIGITO = {24: '1', 56: '2', 92: '3', 28: '4', 66: '5', 80: '6'}


def georreferencia(doc, pagina):
    """Transformación página → (lon, lat) a partir del /Measure del GeoPDF."""
    vp = doc.xref_object(pagina.xref)
    m = re.search(r'/VP\s*\[\s*(\d+) 0 R', vp)
    viewport = doc.xref_object(int(m.group(1)))
    bbox = [float(v) for v in re.search(r'/BBox\s*\[([^\]]+)\]', viewport).group(1).split()]
    medida = doc.xref_object(int(re.search(r'/Measure\s*(\d+) 0 R', viewport).group(1)))
    gpts = [float(v) for v in re.search(r'/GPTS\s*\[([^\]]+)\]', medida).group(1).split()]
    lpts = [float(v) for v in re.search(r'/LPTS\s*\[([^\]]+)\]', medida).group(1).split()]
    gcs = doc.xref_object(int(re.search(r'/GCS\s*(\d+) 0 R', medida).group(1)))
    epsg = int(re.search(r'/EPSG\s*(\d+)', gcs).group(1))
    a_proj = Transformer.from_crs('EPSG:4686', f'EPSG:{epsg}', always_xy=True)
    a_geo = Transformer.from_crs(f'EPSG:{epsg}', 'EPSG:4326', always_xy=True)
    en = [a_proj.transform(gpts[i + 1], gpts[i]) for i in range(0, len(gpts), 2)]
    uv = [(lpts[i], lpts[i + 1]) for i in range(0, len(lpts), 2)]
    coef, *_ = np.linalg.lstsq(np.array([[u, v, 1] for u, v in uv]), np.array(en), rcond=None)
    ancho, alto = bbox[2] - bbox[0], bbox[3] - bbox[1]
    alto_pag = pagina.rect.height

    def a_lonlat(x, y):
        u, v = (x - bbox[0]) / ancho, (alto_pag - y - bbox[1]) / alto
        e, n = np.array([u, v, 1]) @ coef
        return a_geo.transform(e, n), (e, n)
    return a_lonlat


def area_m2(anillo):
    s = 0.0
    for i in range(len(anillo)):
        x1, y1 = anillo[i]; x2, y2 = anillo[(i + 1) % len(anillo)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def dentro(pt, anillo):
    x, y = pt; c = False
    for i in range(len(anillo)):
        x1, y1 = anillo[i]; x2, y2 = anillo[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def n_puntos(d):
    """Cuántos puntos tiene el dibujo: así se reconoce qué número es un rótulo."""
    return sum(2 if i[0] in ('l', 'c') else 4 for i in d['items'])


def puntos(d):
    out = []
    for it in d['items']:
        if it[0] == 'l': out += [it[1], it[2]]
        elif it[0] == 'c': out += [it[1], it[4]]
        elif it[0] == 're': r = it[1]; out += [r.tl, r.tr, r.br, r.bl]
        elif it[0] == 'qu': q = it[1]; out += [q.ul, q.ur, q.lr, q.ll]
    anillo = []
    for p in out:
        if not anillo or abs(anillo[-1][0] - p.x) > 1e-4 or abs(anillo[-1][1] - p.y) > 1e-4:
            anillo.append((p.x, p.y))
    if len(anillo) > 1 and anillo[0] == anillo[-1]:
        anillo = anillo[:-1]
    return anillo


def main():
    pdf, x0, y0, x1, y1, salida = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
    doc = pymupdf.open(pdf)
    pag = doc[0]
    a_lonlat = georreferencia(doc, pag)
    zona = pymupdf.Rect(x0, y0, x1, y1)
    dibujos = [d for d in pag.get_drawings() if d.get('fill') is not None and not d['rect'].is_empty and zona.contains(d['rect'])]
    glifos = [d for d in dibujos if max(d['fill']) < 0.1 and n_puntos(d) in DIGITO]
    res = []
    for d in dibujos:
        if max(d['fill']) < 0.5:
            continue  # rótulos y bordes negros
        anillo = puntos(d)
        if len(anillo) < 3:
            continue
        ll, en = zip(*[a_lonlat(x, y) for x, y in anillo])
        nums = [DIGITO[n_puntos(g)] for g in glifos
                if dentro(((g['rect'].x0 + g['rect'].x1) / 2, (g['rect'].y0 + g['rect'].y1) / 2), anillo)]
        res.append({'etiqueta': nums[0] if nums else '', 'area_ha': round(area_m2(en) / 10000, 3),
                    'anillo': [[round(lo, 7), round(la, 7)] for lo, la in ll]})
    json.dump(res, open(salida, 'w'), indent=1)
    print(f'{len(res)} polígonos · {round(sum(r["area_ha"] for r in res), 2)} ha -> {salida}')


if __name__ == '__main__':
    main()
