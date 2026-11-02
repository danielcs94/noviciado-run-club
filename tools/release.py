#!/usr/bin/env python3
"""
Versiona los archivos de la web antes de publicar (ejecútalo antes de cada commit/push).

GitHub Pages deja que el navegador guarde cada archivo 10 minutos. Sin versión, el móvil
puede mezclar un index.html nuevo con un admin.js viejo (o al revés) y la web se rompe.
Este script pone `?v=<versión>` en las hojas de estilo, en los scripts de entrada y, mediante
un import map, en todos los módulos de js/ (también los de js/rutas/), en las dos páginas.

Uso (desde noviciado-run-club/):
  python3 tools/release.py
"""
import json
import pathlib
import re
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = [ROOT / "index.html", ROOT / "tarjeta.html"]


def main() -> None:
    version = time.strftime("%Y%m%d%H%M")
    modules = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "js").rglob("*.js"))
    importmap = {"imports": {f"./{m}": f"./{m}?v={version}" for m in modules}}
    block = '<script type="importmap">\n' + json.dumps(importmap, indent=2, ensure_ascii=False) + "\n</script>"

    for page in PAGES:
        html = page.read_text(encoding="utf-8")
        html = re.sub(r'href="(css/[\w-]+\.css)(\?v=\w+)?"', rf'href="\1?v={version}"', html)
        html = re.sub(r'src="(js/[\w-]+\.js)(\?v=\w+)?"', rf'src="\1?v={version}"', html)
        if '<script type="importmap">' in html:
            html = re.sub(r'<script type="importmap">.*?</script>', block, html, flags=re.S)
        else:  # el import map tiene que ir antes que cualquier script de tipo módulo
            html = html.replace('<script type="module"', block + '\n<script type="module"', 1)
        page.write_text(html, encoding="utf-8")

    print(f"Versión {version}: {len(modules)} módulos versionados en {len(PAGES)} páginas")


if __name__ == "__main__":
    main()
