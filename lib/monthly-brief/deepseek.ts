export interface DeepSeekResult {
  output:       string;
  finishReason: string | null;
  truncated:    boolean;
}

export async function callDeepSeek(
  systemPrompt: string,
  userMessage: string,
  onChunk?: (totalChars: number) => void,
): Promise<DeepSeekResult> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
      max_tokens: 8192,
      temperature: 0.7,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${errText}`);
  }

  let output = '';
  let finishReason: string | null = null;
  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const json    = JSON.parse(data);
        const choice  = json.choices?.[0];
        const content = choice?.delta?.content;
        if (content) {
          output += content;
          onChunk?.(output.length);
        }
        // finish_reason is set on the final SSE chunk: 'stop' = clean,
        // 'length' = hit max_tokens (truncated mid-output).
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch { /* ignore malformed chunks */ }
    }
  }

  return { output, finishReason, truncated: finishReason === 'length' };
}

// Parts 2 and 3 should be plain HTML fragments, but DeepSeek sometimes wraps
// output in a full document (<html><head>...<body>). Strip those wrappers so
// concatenation produces valid HTML.
export function cleanFragment(html: string): string {
  let out = html.trim();
  out = out.replace(/^```html\s*/i, '').replace(/\s*```$/, '');
  const bodyMatch = out.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) out = bodyMatch[1].trim();
  else {
    out = out.replace(/<!DOCTYPE[^>]*>/gi, '');
    out = out.replace(/<\/?html[^>]*>/gi, '');
    out = out.replace(/<head>[\s\S]*?<\/head>/gi, '');
    out = out.replace(/<\/?body[^>]*>/gi, '');
  }
  // Note: <div> is deliberately excluded — Part 1 opens <div id="monthly-report">
  // and leaves it unclosed by design; Part 3c closes it. Auto-closing div here
  // would render every later part outside the wrapper.
  return balanceTags(out.trim(), ['details', 'ul', 'ol', 'table']);
}

// Closes any tags the model opened but never closed within a single fragment.
// Critical for <details>: an unclosed <details> in Part 1 swallows every
// fragment concatenated after it (Parts 2a..3c) into a collapsed dropdown.
// Naive (counts only, not depth-aware) but the prompts use these tags flat,
// not deeply nested, so the count is enough.
function balanceTags(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    const open  = (out.match(new RegExp(`<${tag}\\b[^>]*>`,  'gi')) ?? []).length;
    const close = (out.match(new RegExp(`</${tag}>`,         'gi')) ?? []).length;
    const missing = open - close;
    if (missing > 0) {
      out += `\n${`</${tag}>`.repeat(missing)}`;
      console.warn(`[cleanFragment] Auto-closed ${missing} stray <${tag}> tag(s) at fragment end.`);
    }
  }
  return out;
}
