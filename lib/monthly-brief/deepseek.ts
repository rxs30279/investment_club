export async function callDeepSeek(
  systemPrompt: string,
  userMessage: string,
  onChunk?: (totalChars: number) => void,
): Promise<string> {
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
        const content = json.choices?.[0]?.delta?.content;
        if (content) {
          output += content;
          onChunk?.(output.length);
        }
      } catch { /* ignore malformed chunks */ }
    }
  }

  return output;
}

// Parts 2 and 3 should be plain HTML fragments, but DeepSeek sometimes wraps
// output in a full document (<html><head>...<body>). Strip those wrappers so
// concatenation produces valid HTML.
export function cleanFragment(html: string): string {
  let out = html.trim();
  out = out.replace(/^```html\s*/i, '').replace(/\s*```$/, '');
  const bodyMatch = out.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  out = out.replace(/<!DOCTYPE[^>]*>/gi, '');
  out = out.replace(/<\/?html[^>]*>/gi, '');
  out = out.replace(/<head>[\s\S]*?<\/head>/gi, '');
  out = out.replace(/<\/?body[^>]*>/gi, '');
  return out.trim();
}
