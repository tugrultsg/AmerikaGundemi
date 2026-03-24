export interface TranslationResult {
  summaryArticle: string;
  fullTranslation: string;
  title: string;
  guests: string[];
  tags: string[];
  thread: string[];
}

export type TranslationOutcome =
  | { ok: true; result: TranslationResult }
  | { ok: false; error: 'timeout' | 'cli_error' | 'malformed_output'; details: string };

export type VideoStatus =
  | 'pending'
  | 'transcribed'
  | 'translated'
  | 'formatted'
  | 'blog_published'
  | 'twitter_published'
  | 'no_transcript'
  | 'translation_timeout'
  | 'translation_error'
  | 'translation_malformed'
  | 'wrong_language'
  | 'permanently_failed';

export interface VideoRecord {
  id: number;
  video_id: string;
  channel: string;
  title: string | null;
  translated_title: string | null;
  status: VideoStatus;
  strategy: 'single' | 'two_pass' | null;
  raw_transcript: string | null;
  cleaned_transcript: string | null;
  summary_article: string | null;
  full_translation: string | null;
  tags: string | null;
  guests: string | null;
  thread: string | null;
  retry_count: number;
  error_details: string | null;
  created_at: string;
  published_at: string | null;
}

export interface Config {
  youtube: {
    channels: string[];
    playlists: string[];
    manualUrls: string[];
    quotaLimit: number;
  };
  translation: {
    promptFile: string;
    chunkSize: number;
    timeoutSingleMs: number;
    timeoutChunkMs: number;
    delayBetweenMs: number;
    maxPerRun: number;
    maxRetries: number;
  };
  blog: {
    repoPath: string;
    siteUrl: string;
  };
  twitter: {
    enabled: boolean;
    maxThreadLength: number;
  };
  db: {
    path: string;
  };
}

export interface NewVideo {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string;
}

export interface SocialPublisher {
  postThread(thread: string[], blogUrl: string): Promise<string[]>;
}
