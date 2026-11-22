"""Build a native bridge executable and prepare Tauri installer resources."""

import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parent.parent
    build = root / ".installer-build"
    build.mkdir(exist_ok=True)
    command = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onedir", "--console",
        "--name", "SagarAIStudioBridge",
        "--distpath", str(build / "payload"),
        "--workpath", str(build / "work"),
        "--specpath", str(build),
    ]
    for package in (
        "camoufox", "fpgen", "playwright", "uvicorn",
        "ua_parser", "ua_parser_builtins", "language_tags",
    ):
        command.extend(["--collect-all", package])
    command.append(str(root / "scripts" / "sagar_ai_studio_bridge.py"))
    subprocess.run(command, cwd=root, check=True)

    payload = build / "payload" / "SagarAIStudioBridge"
    executable = payload / ("SagarAIStudioBridge.exe" if os.name == "nt" else "SagarAIStudioBridge")
    subprocess.run([str(executable), "--check-installation"], check=True)

    # Package launchers alongside the executable so users can open the bridge
    # independently of the desktop app's platform-specific resource directory.
    if os.name != "nt":
        launcher = payload / ("Start Bridge.command" if sys.platform == "darwin" else "start-bridge.sh")
        launcher.write_text(
            '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec ./SagarAIStudioBridge\n',
            encoding="utf-8",
        )
        launcher.chmod(0o755)
    shutil.copy2(root / "docs" / "ai-studio-browser-bridge.md", payload / "Setup.md")
    config = {
        "bundle": {
            "createUpdaterArtifacts": False,
            "resources": {
                "../.installer-build/payload/SagarAIStudioBridge/": "bridge/"
            },
        },
    }
    (build / "tauri-config.json").write_text(json.dumps(config), encoding="utf-8")
    system = "macos" if sys.platform == "darwin" else platform.system().lower()
    architecture = {"aarch64": "arm64", "AMD64": "x64", "x86_64": "x64"}.get(
        platform.machine(), platform.machine()
    )
    archive = build / f"Sagar-AI-Studio-Bridge-{system}-{architecture}"
    shutil.make_archive(str(archive), "zip", root_dir=payload.parent, base_dir=payload.name)
    print(f"Bridge archive: {archive}.zip", flush=True)


if __name__ == "__main__":
    main()
