import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import {
  getTranslationSelection,
  listTranslationModels,
  setTranslationSelection,
} from "../../lib/tauri/ai";
import { CommandError } from "../../lib/tauri/errors";
import type {
  CliProviderStatus,
  CustomProviderSummary,
  TranslationModelList,
  TranslationSelection,
} from "../../types/ai";

type TranslationModelSectionProps = {
  cli: CliProviderStatus[];
  custom: CustomProviderSummary[];
  onConfigureGrok?: () => void;
};

export function agentLabel(
  agent: string,
  cli: CliProviderStatus[],
  custom: CustomProviderSummary[],
) {
  const builtin = cli.find((provider) => provider.id === agent);
  if (builtin) {
    return builtin.label;
  }
  if (agent.startsWith("custom:")) {
    const found = custom.find((provider) => `custom:${provider.id}` === agent);
    if (found) {
      return found.name;
    }
  }
  return agent;
}

/**
 * Translation Model picker: choose the agent (Codex / OpenCode / Claude Code / Antigravity
 * or a saved custom provider) and the model future translation will use.
 * Selecting only persists the choice; it never starts translation and never
 * sends book text anywhere.
 */
export function TranslationModelSection({
  cli,
  custom,
  onConfigureGrok,
}: TranslationModelSectionProps) {
  const [agent, setAgent] = useState("codex");
  const [catalog, setCatalog] = useState<TranslationModelList | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState("");
  const [saved, setSaved] = useState<TranslationSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const catalogRequest = useRef(0);

  const loadCatalog = useCallback((nextAgent: string) => {
    const request = ++catalogRequest.current;
    setLoading(true);
    setLoadError(null);
    listTranslationModels(nextAgent)
      .then((list) => {
        if (request !== catalogRequest.current) return;
        setCatalog(list);
        setSearch("");
      })
      .catch((error: unknown) => {
        if (request !== catalogRequest.current) return;
        setCatalog(null);
        setLoadError(
          error instanceof CommandError
            ? error.message
            : "The model list could not be loaded.",
        );
      })
      .finally(() => {
        if (request === catalogRequest.current) setLoading(false);
      });
  }, []);

  const loadSelection = useCallback(() => {
    getTranslationSelection()
      .then((selection) => {
        setSaved(selection);
        if (selection) {
          setAgent(selection.agent);
          setDraft(selection.model);
          setEffort(selection.reasoningEffort ?? "");
        }
      })
      .catch(() => {
        // A missing selection is not an error; the picker simply starts empty.
      });
  }, []);

  useEffect(() => {
    loadSelection();
  }, [loadSelection]);

  useEffect(() => {
    loadCatalog(agent);
  }, [agent, loadCatalog]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const models = catalog?.models ?? [];
    if (query === "") {
      return models;
    }
    return models.filter(
      (model) =>
        model.id.toLocaleLowerCase().includes(query) ||
        model.label.toLocaleLowerCase().includes(query),
    );
  }, [catalog, search]);

  const selectedModel =
    catalog?.agent === agent
      ? catalog.models.find((model) => model.id === draft.trim())
      : undefined;
  const effortOptions = agent.startsWith("custom:")
    ? ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
    : (selectedModel?.reasoningEfforts ??
      (agent === "codex"
        ? ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
        : agent === "agy"
          ? ["low", "medium", "high"]
          : []));
  const effortOrder = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ];
  const orderedEfforts = [...effortOptions].sort((a, b) => {
    const rank = (value: string) => {
      const index = effortOrder.indexOf(value);
      return index === -1 ? effortOrder.length : index;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const effectiveEffort = effortOptions.includes(effort) ? effort : "";
  const effortLabel = (value: string) =>
    value === "xhigh" ? "XHigh" : value.charAt(0).toUpperCase() + value.slice(1);

  async function handleSave() {
    const model = draft.trim();
    if (model === "") {
      setSaveError("Choose a model from the list or enter one manually.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedNotice(null);
    try {
      const selection = await setTranslationSelection(
        agent,
        model,
        effectiveEffort || null,
      );
      setSaved(selection);
      setSavedNotice(
        `Saved: ${agentLabel(agent, cli, custom)} · ${selection.model} · ${selection.reasoningEffort ?? "Default"}`,
      );
    } catch (error) {
      setSaveError(
        error instanceof CommandError
          ? error.message
          : "The selection could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="ai-translation-model-heading">
      <h3 className="panel__heading" id="ai-translation-model-heading">
        Translation Model
      </h3>
      <p className="dialog__muted">
        The agent and model future translation will use. Saving only remembers the choice
        — nothing is translated and no book text is sent.
      </p>

      {saved ? (
        <p className="dialog__muted">
          Current selection: <strong>{agentLabel(saved.agent, cli, custom)}</strong> ·{" "}
          <strong>{saved.model}</strong> · {saved.reasoningEffort ?? "Default"} effort
        </p>
      ) : (
        <p className="dialog__muted">No translation model selected yet.</p>
      )}

      <div className="form-grid">
        <label className="form-field">
          <span>Agent</span>
          <select
            value={agent}
            onChange={(event) => {
              if (event.target.value === "setup:xai") {
                onConfigureGrok?.();
                return;
              }
              setAgent(event.target.value);
              setDraft("");
              setEffort("");
              setSavedNotice(null);
              setSaveError(null);
            }}
            aria-label="Translation agent"
          >
            {cli.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
                {provider.available ? "" : " (not installed)"}
              </option>
            ))}
            {custom.map((provider) => (
              <option key={provider.id} value={`custom:${provider.id}`}>
                {provider.name}
                {provider.baseUrl === "https://api.x.ai/v1" ? " · xAI API" : " (custom)"}
              </option>
            ))}
            {onConfigureGrok &&
            !custom.some((provider) => provider.baseUrl === "https://api.x.ai/v1") ? (
              <option value="setup:xai">Grok (xAI) · API key ချိတ်ဆက်ရန်</option>
            ) : null}
          </select>
        </label>
        <label className="form-field">
          <span>Search models</span>
          <input
            type="search"
            aria-label="Search models"
            placeholder="Search models"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {agent === "agy" ? (
        <p className="dialog__muted" role="status">
          {cli.some((provider) => provider.id === "agy" && provider.available)
            ? "Antigravity CLI ကို တွေ့ရှိပါသည်။ အောက်မှ မော်ဒယ်ရွေးပြီး Save နှိပ်ပါ။ စာရင်းမပေါ်ပါက Refresh နှိပ်ပါ။"
            : "Antigravity ဖြင့် ဘာသာပြန်ရန် agy CLI လိုအပ်ပါသည်။ Antigravity အက်ပ်နှင့်အတူ CLI ကိုလည်း ထည့်သွင်းပြီးနောက် Settings ကို ပြန်ဖွင့်ပါ။"}
        </p>
      ) : null}

      {agent === "grok" ? (
        <p className="dialog__muted" role="status">
          Grok Build CLI တွင် grok login ဖြင့် အကောင့်ဝင်ထားရန် လိုပါသည်။ Sagar တွင် API key ဖြည့်ရန်
          မလိုပါ။ သင့်အကောင့်၏ Grok Build အသုံးပြုခွင့်နှင့် ကန့်သတ်ချက်များအတိုင်း ဘာသာပြန်ပါမည်။
        </p>
      ) : null}

      <div className="model-refresh-row">
        <button
          type="button"
          className="icon-button"
          disabled={loading}
          onClick={() => loadCatalog(agent)}
          aria-label="Refresh models"
          title="Refresh models"
        >
          <Icon name="refresh" size={16} spin={loading} />
        </button>
        {catalog ? (
          <span className="dialog__muted" role="status">
            {catalog.source === "live" ? "Live list" : "Known list"} ·{" "}
            {search.trim() === ""
              ? `${catalog.models.length} models`
              : `${filtered.length} of ${catalog.models.length} models`}
            {" · "}
            {catalog.message}
          </span>
        ) : null}
      </div>

      {loadError ? (
        <StatusNotice kind="error" onRetry={() => loadCatalog(agent)}>
          {loadError}
        </StatusNotice>
      ) : null}
      {loading ? <StatusNotice kind="loading">Loading models…</StatusNotice> : null}

      {!loading && !loadError && filtered.length === 0 ? (
        <p className="dialog__muted">
          {search.trim() === ""
            ? "No models were listed for this agent."
            : "No models match your search."}
        </p>
      ) : null}

      {filtered.length > 0 ? (
        <div
          className="model-list"
          role="radiogroup"
          aria-label="Available models"
          tabIndex={0}
        >
          {filtered.map((model) => (
            <label key={model.id} className="model-list__row">
              <input
                type="radio"
                name="translation-model"
                checked={draft === model.id}
                onChange={() => {
                  setDraft(model.id);
                  setEffort("");
                  setSaveError(null);
                  setSavedNotice(null);
                }}
              />
              <span className="model-list__main">
                <span className="model-list__title">{model.label}</span>
                {model.detail ? (
                  <span className="model-list__meta">{model.detail}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <label className="form-field">
        <span>Or enter a model ID manually</span>
        <input
          type="text"
          value={draft}
          maxLength={128}
          placeholder="e.g. gpt-5.6-sol"
          onChange={(event) => {
            setDraft(event.target.value);
            setEffort("");
            setSaveError(null);
            setSavedNotice(null);
          }}
        />
      </label>

      <label className="form-field">
        <span>Reasoning effort{agent === "opencode" ? " / model variant" : ""}</span>
        <select
          value={effectiveEffort}
          disabled={loading || draft.trim() === ""}
          aria-describedby="reasoning-effort-help"
          onChange={(event) => {
            setEffort(event.target.value);
            setSavedNotice(null);
            setSaveError(null);
          }}
        >
          <option value="">Default (provider setting)</option>
          {orderedEfforts.map((value) => (
            <option key={value} value={value}>
              {effortLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <p className="dialog__muted" id="reasoning-effort-help">
        {agent.startsWith("custom:")
          ? "Send the selected reasoning effort to your API provider. Available choices are overrides, not detected model capabilities. If the provider rejects a value, choose another level or Default to use its own setting."
          : effortOptions.length === 0
            ? "No adjustable effort levels are listed for this model. The provider default will be used."
            : "Higher effort can take longer and use more tokens. Available levels depend on the model and provider."}
      </p>

      {saveError ? <StatusNotice kind="error">{saveError}</StatusNotice> : null}
      {savedNotice ? <StatusNotice kind="success">{savedNotice}</StatusNotice> : null}

      <div className="button-row dialog__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || loading || draft.trim() === ""}
          onClick={() => void handleSave()}
        >
          <Icon name="save" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
