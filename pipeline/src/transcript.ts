// youtube-transcript has broken ESM exports; import from the ESM dist file directly
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { getVideoByVideoId, updateVideoStatus } from './db.js';
import { logger } from './logger.js';

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
  lang?: string;
}

function cleanTranscript(segments: TranscriptSegment[]): string {
  // Merge segments into paragraphs, removing timestamps
  const lines: string[] = [];
  let currentParagraph: string[] = [];
  let lastOffset = 0;

  for (const seg of segments) {
    const text = seg.text
      .replace(/\[.*?\]/g, '')       // Remove [Music], [Applause], etc.
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();

    if (!text) continue;

    // Start new paragraph on gaps > 4 seconds (topic/speaker change likely)
    if (seg.offset - lastOffset > 4000 && currentParagraph.length > 0) {
      lines.push(currentParagraph.join(' '));
      currentParagraph = [];
    }

    currentParagraph.push(text);
    lastOffset = seg.offset + seg.duration;
  }

  if (currentParagraph.length > 0) {
    lines.push(currentParagraph.join(' '));
  }

  return lines.join('\n\n');
}

function detectLanguage(segments: TranscriptSegment[]): string | null {
  // youtube-transcript may include lang metadata
  for (const seg of segments) {
    if (seg.lang) return seg.lang;
  }
  return null;
}

export async function fetchAndCleanTranscript(videoId: string): Promise<{
  success: boolean;
  raw?: string;
  cleaned?: string;
  error?: 'no_transcript' | 'wrong_language';
}> {
  const existing = getVideoByVideoId(videoId);
  if (existing && existing.cleaned_transcript && existing.cleaned_transcript !== 'null') {
    logger.info({ videoId }, 'Transcript already fetched, skipping');
    return { success: true, raw: existing.raw_transcript!, cleaned: existing.cleaned_transcript };
  }

  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }) as TranscriptSegment[];

    if (!segments || segments.length === 0) {
      logger.warn({ videoId }, 'No transcript segments returned');
      updateVideoStatus(videoId, 'no_transcript', { error_details: 'No segments returned' });
      return { success: false, error: 'no_transcript' };
    }

    // Language check
    const lang = detectLanguage(segments);
    if (lang && !lang.startsWith('en')) {
      logger.warn({ videoId, lang }, 'Non-English transcript detected');
      updateVideoStatus(videoId, 'wrong_language', { error_details: `Detected language: ${lang}` });
      return { success: false, error: 'wrong_language' };
    }

    const raw = segments.map((s) => `[${s.offset}] ${s.text}`).join('\n');
    const cleaned = cleanTranscript(segments);

    updateVideoStatus(videoId, 'transcribed', {
      raw_transcript: raw,
      cleaned_transcript: cleaned,
    });

    logger.info({ videoId, segments: segments.length, words: cleaned.split(/\s+/).length }, 'Transcript fetched and cleaned');
    return { success: true, raw, cleaned };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ videoId, error: message }, 'Failed to fetch transcript');
    updateVideoStatus(videoId, 'no_transcript', { error_details: message });
    return { success: false, error: 'no_transcript' };
  }
}
