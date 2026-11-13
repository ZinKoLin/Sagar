import { Icon } from "../../components/Icon";

/** Fixed transport messages and counters only; never contains request/response text. */
export function ApiRequestDetails({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <details className="dialog__muted">
      <summary>
        <Icon name="list" /> API request details
      </summary>
      <p>
        No API key, book text or reasoning text is included. Copy these details when
        reporting a stalled request.
      </p>
      <ol aria-label="API request trace">
        {[...new Set(messages)].map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ol>
    </details>
  );
}
