# AI Studio browser bridge

## Prebuilt installers

The Windows MSI installs Sagar and a **Sagar AI Studio Bridge** Start menu
shortcut. For macOS, install the DMG and extract the matching bridge ZIP,
then open **Start Bridge.command**. For Linux, install the DEB or open the
AppImage, extract the matching bridge ZIP, and run **start-bridge.sh**.
Keep the entire extracted bridge folder together. These bridge packages
include Python and its dependencies.

The first launch downloads Camoufox and opens Google AI Studio for sign-in.
Use the connection fields below to connect Sagar. The bridge key is stored at
`%LOCALAPPDATA%\SagarAIStudioBridge\bridge.key` on Windows and
`~/SagarAIStudioBridge/bridge.key` on macOS and Linux.
These local builds are unsigned. Clean-machine native installation and UI
behavior must be checked on each target OS.

## Run from source

Run the commands from the Sagar repository root in PowerShell.

```powershell
py -3.12 -m venv .venv-sagar-bridge
.venv-sagar-bridge\Scripts\python.exe -m pip install -r scripts/sagar-ai-studio-requirements.txt
.venv-sagar-bridge\Scripts\python.exe -m camoufox fetch
.venv-sagar-bridge\Scripts\python.exe scripts/sagar_ai_studio_bridge.py
```

Sign in to Google AI Studio in the Camoufox window opened by the bridge.
Keep that window and the bridge running while using Sagar. The bridge keeps
its own browser profile, so it can reuse your login on the next startup.

In Sagar, add an AI custom provider with **OpenAI-compatible** format.

| Field | Value |
| --- | --- |
| Name | AI Studio Browser |
| Base URL | `http://127.0.0.1:8765/v1` |
| API key | Contents of `%LOCALAPPDATA%\SagarAIStudioBridge\bridge.key` |
| Model | `ai-studio` |

Save and test the connection, then select that provider and model and leave
reasoning effort at Default. The connection test only checks the local model
list. Try a short sample to verify actual generation.

Each request opens a new AI Studio prompt, fills the system instruction and
user text, and waits for the completed reply before returning it to Sagar.
The Google model is the one selected by AI Studio for a new prompt. While
one request is running, another receives a busy response and can be retried.
The local server is available only on this computer. Google receives the text
you submit, and AI Studio account limits still apply.
