import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

// UUIDv5(completion id, DNS namespace), RFC 9562; confirm NEAR's mapping live.
export function inferenceId(chatId: string): string {
  const dns = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const value = createHash('sha1').update(dns).update(chatId, 'utf8').digest().subarray(0, 16);
  value[6] = (value[6] & 15) | 80; value[8] = (value[8] & 63) | 128;
  const hex = value.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export class Meter {
  chatId = '';
  usage?: { prompt_tokens: number; completion_tokens: number };
  private text = '';
  private decoder = new StringDecoder('utf8');
  private streaming: boolean;
  constructor(streaming: boolean) { this.streaming = streaming; }
  push(bytes: Buffer): void {
    this.text += this.decoder.write(bytes);
    if (this.streaming) this.frames();
  }
  finish(): void {
    this.text += this.decoder.end();
    if (this.streaming) { this.frames(); this.frame(this.text); }
    else this.value(this.text);
    this.text = '';
  }
  private frames(): void {
    let separator: RegExpExecArray | null;
    while ((separator = /\r?\n\r?\n/.exec(this.text))) {
      this.frame(this.text.slice(0, separator.index));
      this.text = this.text.slice(separator.index + separator[0].length);
    }
  }
  private frame(frame: string): void {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (data && data !== '[DONE]') this.value(data);
  }
  private value(text: string): void {
    let value;
    try { value = JSON.parse(text); } catch { return; } // Partial/malformed metadata charges the reservation.
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    if (!this.chatId && typeof value.id === 'string' && value.id) this.chatId = value.id;
    const usage = value.usage;
    if (usage && [usage.prompt_tokens, usage.completion_tokens].every(n => Number.isSafeInteger(n) && n >= 0)) {
      this.usage = { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens };
    }
  }
}
