#!/usr/bin/env python3
"""
capture_gotcha.py — SAM
Añade una gotcha al SKILL.md correcto basándose en el skill destino.

Uso:
  python capture_gotcha.py --skill managing-supabase --error "..." --fix "..."
  echo '{"skill":"managing-supabase","error":"...","fix":"..."}' | python capture_gotcha.py

También puede ser llamado por Antigravity como post-hook.
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import date

# Raíz del proyecto — ajustar si el script se mueve
SKILLS_ROOT = Path(__file__).parent.parent.parent  # .agent/skills/

SKILL_KEYWORD_MAP = {
    "supabase": "managing-supabase",
    "query":    "managing-supabase",
    "rpc":      "managing-supabase",
    "mapeo":    "managing-supabase",
    "fallback": "managing-supabase",
    "tabla":    "managing-supabase",
    "insert":   "managing-supabase",
    "update":   "managing-supabase",
    "asignacion": "managing-assignments",
    "assignment": "managing-assignments",
    "workflow": "managing-assignments",
    "labor":    "managing-assignments",
    "estado":   "managing-assignments",
    "suerte":   "managing-assignments",
    "hacienda": "managing-assignments",
    "operador": "managing-assignments",
    "supervisor": "managing-assignments",
    "form":     "building-react-forms",
    "formulario": "building-react-forms",
    "draft":    "building-react-forms",
    "submit":   "building-react-forms",
    "input":    "building-react-forms",
    "select":   "building-react-forms",
    "reset":    "building-react-forms",
}


def detect_skill_from_text(text: str) -> str | None:
    lower = text.lower()
    for keyword, skill in SKILL_KEYWORD_MAP.items():
        if keyword in lower:
            return skill
    return None


def find_skill_path(skill_name: str) -> Path | None:
    path = SKILLS_ROOT / skill_name / "SKILL.md"
    return path if path.exists() else None


def already_exists(content: str, error_summary: str) -> bool:
    # Compara los primeros 50 chars del error para evitar duplicados
    key = error_summary.strip()[:50].lower()
    return key in content.lower()


def append_gotcha(skill_path: Path, error: str, fix: str) -> bool:
    today = date.today().isoformat()
    fix_part = f" → solución: {fix}" if fix else ""
    entry = f"\n- **[{today}]** {error.strip()[:200]}{fix_part}"

    content = skill_path.read_text(encoding="utf-8")

    if already_exists(content, error):
        print(f"⚠️  Gotcha similar ya existe en {skill_path.name}, omitiendo.")
        return False

    if "## Gotchas" in content:
        # Insertar al inicio de la sección Gotchas (más reciente primero)
        content = content.replace("## Gotchas\n", f"## Gotchas{entry}\n", 1)
    else:
        content += f"\n\n## Gotchas{entry}\n"

    skill_path.write_text(content, encoding="utf-8")
    print(f"✅ Gotcha añadida a {skill_path}")
    return True


def main():
    # Modo 1: argumentos CLI
    if len(sys.argv) > 1:
        parser = argparse.ArgumentParser(description="Captura gotchas en SAM skills")
        parser.add_argument("--skill", help="Nombre del skill destino (ej: managing-supabase)")
        parser.add_argument("--error", required=True, help="Descripción del error")
        parser.add_argument("--fix", default="", help="Cómo se resolvió")
        args = parser.parse_args()

        skill_name = args.skill or detect_skill_from_text(args.error)
        if not skill_name:
            print("❌ No se pudo detectar el skill destino. Usa --skill para especificarlo.")
            sys.exit(1)

    # Modo 2: JSON por stdin (para hooks de Antigravity)
    elif not sys.stdin.isatty():
        try:
            data = json.loads(sys.stdin.read())
        except json.JSONDecodeError:
            print("❌ JSON inválido en stdin.")
            sys.exit(1)

        error = data.get("error", "")
        fix = data.get("fix", "")
        skill_name = data.get("skill") or detect_skill_from_text(error)

        if not skill_name or not error:
            print("❌ Se requieren 'error' y 'skill' (o contexto suficiente para detectarlo).")
            sys.exit(1)

        args = type("Args", (), {"error": error, "fix": fix})()

    else:
        print("Uso: python capture_gotcha.py --error '...' [--skill nombre] [--fix '...']")
        sys.exit(0)

    skill_path = find_skill_path(skill_name)
    if not skill_path:
        print(f"❌ No existe el skill '{skill_name}' en {SKILLS_ROOT}")
        print(f"   Skills disponibles: {[p.name for p in SKILLS_ROOT.iterdir() if p.is_dir()]}")
        sys.exit(1)

    append_gotcha(skill_path, args.error, getattr(args, "fix", ""))


if __name__ == "__main__":
    main()
