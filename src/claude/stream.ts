// Shared Claude streaming call. Used by the Electron main process (with the stored API key)
// and, as a fallback, directly in the browser build.
import Anthropic from '@anthropic-ai/sdk';

export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_start'; name: string }
  | { kind: 'tool_input'; text: string };

export interface StreamOutcome {
  message?: Anthropic.Beta.BetaMessage;
  error?: { status?: number; type: string; message: string; retryable: boolean; jsonError?: boolean };
}

export async function streamClaude(
  client: Anthropic,
  params: any,
  onEvent: (e: StreamEvent) => void,
  register?: (abort: () => void) => void,
): Promise<StreamOutcome> {
  try {
    const stream = client.beta.messages.stream(params);
    register?.(() => stream.abort());
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const b: any = event.content_block;
        if (b.type === 'tool_use') onEvent({ kind: 'tool_start', name: b.name });
      } else if (event.type === 'content_block_delta') {
        const d: any = event.delta;
        if (d.type === 'text_delta') onEvent({ kind: 'text', text: d.text });
        else if (d.type === 'thinking_delta') onEvent({ kind: 'thinking', text: d.thinking });
        else if (d.type === 'input_json_delta') onEvent({ kind: 'tool_input', text: d.partial_json });
      }
    }
    const message = await stream.finalMessage();
    return { message };
  } catch (err: any) {
    if (err instanceof Anthropic.APIError) {
      const status = (err as any).status as number | undefined;
      const retryable = status === 429 || status === 529 || (status !== undefined && status >= 500);
      let type = 'api_error';
      if (err instanceof Anthropic.AuthenticationError) type = 'authentication_error';
      else if (err instanceof Anthropic.PermissionDeniedError) type = 'permission_error';
      else if (err instanceof Anthropic.NotFoundError) type = 'not_found_error';
      else if (err instanceof Anthropic.RateLimitError) type = 'rate_limit_error';
      else if (err instanceof Anthropic.BadRequestError) type = 'invalid_request_error';
      else if (err instanceof Anthropic.APIConnectionError) type = 'connection_error';
      return { error: { status, type, message: err.message, retryable: retryable || type === 'connection_error' } };
    }
    if (err?.name === 'AbortError' || /abort/i.test(String(err?.message))) return { error: { type: 'aborted', message: 'Stopped', retryable: false } };
    // Anything else while consuming the stream is most likely an unparseable eager-streamed tool input.
    return { error: { type: 'json_error', message: String(err?.message ?? err), retryable: true, jsonError: true } };
  }
}
