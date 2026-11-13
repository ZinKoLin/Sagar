import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import {
  checkAiCli,
  deleteAiCustomProvider,
  listAiProviders,
  saveAiCustomProvider,
  testAiCustomProvider,
} from "../../lib/tauri/ai";
import { CommandError } from "../../lib/tauri/errors";
import type {
  AiProviderList,
  CliCheckResult,
  CustomProviderSummary,
  CustomTestResult,
} from "../../types/ai";
import { type AppearancePreferences, AppearanceSettings } from "./AppearanceSettings";
import { TranslationModelSection } from "./TranslationModelSection";

type AiSettingsDialogProps = {
  appearance: AppearancePreferences;
  onClose: () => void;
};

type CustomFormState = {
  editingId: string | null;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  fieldErrors: Record<string, string>;
  saving: boolean;
};

const emptyForm: CustomFormState = {
  editingId: null,
  name: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  fieldErrors: {},
  saving: false,
};

/**
 * AI provider settings dialog (settings-only slice): CLI availability for
 * Codex / OpenCode / Claude Code plus user-added OpenAI-compatible
 * endpoints. Nothing here sends book text anywhere.
 */
export function AiSettingsDialog({ onClose, appearance }: AiSettingsDialogProps) {
  const [providers, setProviders] = useState<AiProviderList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [checkResults, setCheckResults] = useState<Record<string, CliCheckResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, CustomTestResult>>({});
  const [form, setForm] = useState<CustomFormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [tab, setTab] = useState<"appearance" | "providers" | "translation">(
    "appearance",
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  const loadProviders = useCallback(() => {
    setLoadError(null);
    listAiProviders()
      .then(setProviders)
      .catch((error: unknown) => {
        setLoadError(
          error instanceof CommandError
            ? error.message
            : "AI settings could not be loaded.",
        );
      });
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ) ?? [],
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  async function handleCheck(providerId: string) {
    setChecking((current) => ({ ...current, [providerId]: true }));
    setActionError(null);
    try {
      const result = await checkAiCli(providerId);
      setCheckResults((current) => ({ ...current, [providerId]: result }));
      loadProviders();
    } catch (error) {
      setActionError(error instanceof CommandError ? error.message : "The check failed.");
    } finally {
      setChecking((current) => ({ ...current, [providerId]: false }));
    }
  }

  function openAddForm() {
    setForm(emptyForm);
    setFormOpen(true);
    setActionError(null);
  }

  function openEditForm(provider: CustomProviderSummary) {
    setForm({
      editingId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey: "",
      fieldErrors: {},
      saving: false,
    });
    setFormOpen(true);
    setActionError(null);
  }

  function openGrokForm() {
    const existing = providers?.custom.find(
      (provider) => provider.baseUrl === "https://api.x.ai/v1",
    );
    setTab("providers");
    if (existing) {
      openEditForm(existing);
    } else {
      setForm({
        ...emptyForm,
        name: "Grok (xAI)",
        baseUrl: "https://api.x.ai/v1",
        model: "grok-4.7",
      });
      setFormOpen(true);
      setActionError(null);
    }
  }

  function fieldErrorFor(code: string): [string, string] | null {
    switch (code) {
      case "invalid_provider_name":
        return ["name", "Enter a provider name of 1–64 characters."];
      case "invalid_base_url":
        return ["baseUrl", "Use a full http(s) URL such as https://api.example.com/v1."];
      case "invalid_api_key":
        return ["apiKey", "Enter an API key."];
      case "invalid_model":
        return ["model", "Enter a model name of 1–128 characters."];
      default:
        return null;
    }
  }

  async function handleSaveForm() {
    setActionError(null);
    setForm((current) => ({ ...current, fieldErrors: {}, saving: true }));
    try {
      await saveAiCustomProvider({
        id: form.editingId ?? undefined,
        name: form.name,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey === "" ? null : form.apiKey,
        model: form.model,
      });
      setForm(emptyForm);
      setFormOpen(false);
      loadProviders();
    } catch (error) {
      const mapped = error instanceof CommandError ? fieldErrorFor(error.code) : null;
      if (mapped) {
        const [field, message] = mapped;
        setForm((current) => ({
          ...current,
          saving: false,
          fieldErrors: { [field]: message },
        }));
      } else {
        setForm((current) => ({ ...current, saving: false }));
        setActionError(
          error instanceof CommandError
            ? error.message
            : "The provider could not be saved.",
        );
      }
    }
  }

  async function handleDelete(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setBusyDelete(true);
    setActionError(null);
    try {
      await deleteAiCustomProvider(id);
      setConfirmDelete(null);
      setTestResults((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      if (form.editingId === id) {
        setForm(emptyForm);
        setFormOpen(false);
      }
      loadProviders();
    } catch (error) {
      setActionError(
        error instanceof CommandError
          ? error.message
          : "The provider could not be removed.",
      );
    } finally {
      setBusyDelete(false);
    }
  }

  async function handleTest(id: string) {
    setTesting((current) => ({ ...current, [id]: true }));
    setActionError(null);
    try {
      const result = await testAiCustomProvider(id);
      setTestResults((current) => ({ ...current, [id]: result }));
    } catch (error) {
      setActionError(
        error instanceof CommandError ? error.message : "The connection test failed.",
      );
    } finally {
      setTesting((current) => ({ ...current, [id]: false }));
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="panel__header">
          <h2 className="panel__heading" id="ai-settings-title">
            Settings
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            title="Close"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        {tab !== "appearance" ? (
          <StatusNotice kind="info">
            API keys stay on this computer in the app database and are never shown again.
            Settings never send book text; a connection test only requests the
            provider&apos;s model list.
          </StatusNotice>
        ) : null}

        <div
          className="tabs"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
              return;
            }
            event.preventDefault();
            const tabs = ["appearance", "providers", "translation"] as const;
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const next =
              tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
            setTab(next);
            document.getElementById(`ai-tab-${next}`)?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id="ai-tab-appearance"
            aria-selected={tab === "appearance"}
            aria-controls="ai-panel-appearance"
            tabIndex={tab === "appearance" ? 0 : -1}
            className="tab"
            onClick={() => setTab("appearance")}
          >
            <Icon name="sun" />
            Appearance
          </button>
          <button
            type="button"
            role="tab"
            id="ai-tab-providers"
            aria-selected={tab === "providers"}
            aria-controls="ai-panel-providers"
            tabIndex={tab === "providers" ? 0 : -1}
            className="tab"
            onClick={() => setTab("providers")}
          >
            <Icon name="sparkles" />
            Providers
          </button>
          <button
            type="button"
            role="tab"
            id="ai-tab-translation"
            aria-selected={tab === "translation"}
            aria-controls="ai-panel-translation"
            tabIndex={tab === "translation" ? 0 : -1}
            className="tab"
            onClick={() => setTab("translation")}
          >
            <Icon name="sparkles" />
            Translation Model
          </button>
        </div>

        <div
          role="tabpanel"
          id="ai-panel-appearance"
          aria-labelledby="ai-tab-appearance"
          hidden={tab !== "appearance"}
        >
          <AppearanceSettings {...appearance} />
        </div>

        {tab !== "appearance" && loadError ? (
          <StatusNotice kind="error" onRetry={loadProviders}>
            {loadError}
          </StatusNotice>
        ) : null}
        {tab !== "appearance" && !loadError && !providers ? (
          <StatusNotice kind="loading">Loading AI providers…</StatusNotice>
        ) : null}

        {providers ? (
          <>
            <div
              role="tabpanel"
              id="ai-panel-providers"
              aria-labelledby="ai-tab-providers"
              hidden={tab !== "providers"}
            >
              <section aria-labelledby="ai-cli-heading">
                <h3 className="panel__heading" id="ai-cli-heading">
                  Coding assistants
                </h3>
                <p className="dialog__muted">
                  Detected from tools installed on this computer. Select Check to verify a
                  tool responds.
                </p>
                <ul className="project-list">
                  {providers.cli.map((provider) => {
                    const result = checkResults[provider.id];
                    const isChecking = checking[provider.id] ?? false;
                    return (
                      <li key={provider.id} className="project-item">
                        <div className="project-row">
                          <span className="project-row__main">
                            <span className="project-row__title">{provider.label}</span>
                            <span className="project-row__meta">
                              Looks for <code>{provider.binaries.join(", ")}</code> in
                              standard install locations
                              {result?.version ? ` · ${result.version}` : null}
                              {result && !result.connected
                                ? ` · ${result.message}`
                                : null}
                            </span>
                          </span>
                          <span className="project-row__progress">
                            <span
                              className={`chapter-export-status chapter-export-status--${result?.connected ? "reviewed" : provider.available ? "draft" : "original"}`}
                            >
                              {result?.connected
                                ? "Connected"
                                : provider.available
                                  ? "Available"
                                  : "Not found"}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="btn"
                            disabled={isChecking}
                            onClick={() => void handleCheck(provider.id)}
                          >
                            <Icon name="refresh" />
                            {isChecking ? "Checking…" : "Check"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section aria-labelledby="ai-custom-heading">
                <h3 className="panel__heading" id="ai-custom-heading">
                  Custom providers
                </h3>
                <p className="dialog__muted">
                  OpenAI-compatible endpoints: a base URL, an API key and a model. Test
                  requests only the model list.
                </p>
                {providers.custom.length === 0 ? (
                  <p className="dialog__muted">No custom providers yet.</p>
                ) : (
                  <ul className="project-list">
                    {providers.custom.map((provider) => {
                      const result = testResults[provider.id];
                      const isTesting = testing[provider.id] ?? false;
                      return (
                        <li key={provider.id} className="project-item">
                          <div className="project-row">
                            <span className="project-row__main">
                              <span className="project-row__title">{provider.name}</span>
                              <span className="project-row__meta">
                                {provider.baseUrl} · {provider.model} ·{" "}
                                {provider.hasApiKey ? "key saved" : "no key"}
                                {result ? ` · ${result.message}` : null}
                              </span>
                            </span>
                            <span className="project-row__progress">
                              <span
                                className={`chapter-export-status chapter-export-status--${result?.ok ? "reviewed" : "original"}`}
                              >
                                {result ? (result.ok ? "Connected" : "Failed") : "Saved"}
                              </span>
                            </span>
                          </div>
                          <div className="button-row">
                            <button
                              type="button"
                              className="btn"
                              disabled={isTesting}
                              onClick={() => void handleTest(provider.id)}
                            >
                              <Icon name="refresh" />
                              {isTesting ? "Testing…" : "Test"}
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => openEditForm(provider)}
                            >
                              <Icon name="edit" />
                              Edit
                            </button>
                            <button
                              type="button"
                              className={
                                confirmDelete === provider.id ? "btn btn--danger" : "btn"
                              }
                              disabled={busyDelete}
                              onClick={() => void handleDelete(provider.id)}
                            >
                              <Icon name="trash" />
                              {confirmDelete === provider.id
                                ? "Confirm delete"
                                : "Delete"}
                            </button>
                            {confirmDelete === provider.id ? (
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setConfirmDelete(null)}
                              >
                                <Icon name="close" />
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!formOpen ? (
                  <div className="button-row">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={openAddForm}
                    >
                      <Icon name="plus" />
                      Add custom provider
                    </button>
                    <button type="button" className="btn" onClick={openGrokForm}>
                      <Icon name="sparkles" />
                      Grok (xAI) ချိတ်ဆက်ရန်
                    </button>
                  </div>
                ) : null}
              </section>

              {formOpen ? (
                <section aria-label={form.editingId ? "Edit provider" : "Add provider"}>
                  {form.baseUrl === "https://api.x.ai/v1" ? (
                    <p className="dialog__muted">
                      Grok ကို xAI API ဖြင့် တိုက်ရိုက်သုံးပါမည်။ xAI API key ဖြည့်ပြီး Save နှိပ်ပါ။ ပြီးလျှင်
                      Translation Model တွင် Grok (xAI) ကို ရွေးပါ။ ဘာသာပြန်ချိန်၌ စာသားကို xAI သို့
                      ပို့မည်ဖြစ်ပြီး သင့် API အကောင့်မှ အသုံးပြုခ ကောက်ခံနိုင်ပါသည်။
                    </p>
                  ) : null}
                  <div className="form-grid">
                    <label className="form-field">
                      <span>Name</span>
                      <input
                        type="text"
                        value={form.name}
                        maxLength={64}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, name: event.target.value }))
                        }
                        aria-invalid={form.fieldErrors.name !== undefined}
                      />
                      {form.fieldErrors.name ? (
                        <span className="form-field__error">{form.fieldErrors.name}</span>
                      ) : null}
                    </label>
                    <label className="form-field">
                      <span>Model</span>
                      <input
                        type="text"
                        value={form.model}
                        maxLength={128}
                        placeholder="gpt-4o-mini"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
                        }
                        aria-invalid={form.fieldErrors.model !== undefined}
                      />
                      {form.fieldErrors.model ? (
                        <span className="form-field__error">
                          {form.fieldErrors.model}
                        </span>
                      ) : null}
                    </label>
                  </div>
                  <label className="form-field">
                    <span>Base URL</span>
                    <input
                      type="url"
                      value={form.baseUrl}
                      placeholder="https://api.example.com/v1"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          baseUrl: event.target.value,
                        }))
                      }
                      aria-invalid={form.fieldErrors.baseUrl !== undefined}
                    />
                    {form.fieldErrors.baseUrl ? (
                      <span className="form-field__error">
                        {form.fieldErrors.baseUrl}
                      </span>
                    ) : null}
                  </label>
                  <label className="form-field">
                    <span>
                      API key
                      {form.editingId ? " (leave blank to keep the saved key)" : ""}
                    </span>
                    <input
                      type="password"
                      value={form.apiKey}
                      autoComplete="off"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, apiKey: event.target.value }))
                      }
                      aria-invalid={form.fieldErrors.apiKey !== undefined}
                    />
                    {form.fieldErrors.apiKey ? (
                      <span className="form-field__error">{form.fieldErrors.apiKey}</span>
                    ) : null}
                  </label>
                  <div className="button-row dialog__actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={form.saving}
                      onClick={() => {
                        setForm(emptyForm);
                        setFormOpen(false);
                      }}
                    >
                      <Icon name="close" />
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={form.saving}
                      onClick={() => void handleSaveForm()}
                    >
                      <Icon name="save" />
                      {form.saving ? "Saving…" : form.editingId ? "Save" : "Add provider"}
                    </button>
                  </div>
                </section>
              ) : null}

              {actionError ? (
                <StatusNotice kind="error">{actionError}</StatusNotice>
              ) : null}
            </div>
            <div
              role="tabpanel"
              id="ai-panel-translation"
              aria-labelledby="ai-tab-translation"
              hidden={tab !== "translation"}
            >
              {tab === "translation" ? (
                <TranslationModelSection
                  cli={providers.cli}
                  custom={providers.custom}
                  onConfigureGrok={openGrokForm}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
