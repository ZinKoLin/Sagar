import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { AiGenerateDialog } from "../src/features/translator/AiGenerateDialog";
import { useChapterEditor } from "../src/features/translator/useChapterEditor";
import "../src/styles/tokens.css";
import "../src/styles/app.css";

// Exercise the real dialog and command bridge with a synthetic local backend.
mockIPC(
  (command, payload) => {
    switch (command) {
      case "list_ai_providers":
        return {
          cli: [{ id: "codex", label: "Codex", binaries: ["codex"], available: true }],
          custom: [],
        };
      case "get_translation_selection":
        return {
          agent: "codex",
          model: "fixture-model",
          reasoningEffort: "low",
          updatedAt: "",
        };
      case "get_project":
        return { id: "fixture-project", sourceLanguage: "en", targetLanguage: "my" };
      case "get_book_settings":
        return { instructions: "" };
      case "start_ai_translation": {
        const timeout =
          payload && "timeoutMinutes" in payload ? payload.timeoutMinutes : null;
        const output = document.querySelector("#captured");
        if (output)
          output.textContent = `Captured timeoutMinutes: ${String(timeout)} (no model called)`;
        return { jobId: "fixture-job" };
      }
      case "cancel_ai_translation":
        return emit("ai-translation-event", {
          jobId: "fixture-job",
          chapterId: "fixture-chapter",
          kind: "cancelled",
          partialText: null,
          proposalHtml: null,
          message: "Cancelled synthetic run",
        });
      default:
        throw new Error(`Unexpected test command: ${command}`);
    }
  },
  { shouldMockEvents: true },
);

function Fixture() {
  const editor = useChapterEditor(null);
  return (
    <AiGenerateDialog
      projectId="fixture-project"
      chapterId="fixture-chapter"
      editor={editor}
      onClose={() => {}}
    />
  );
}
const root = document.querySelector("#root");
if (root) createRoot(root).render(<Fixture />);
