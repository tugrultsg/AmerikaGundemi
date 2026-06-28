declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  export class YoutubeTranscript {
    static fetchTranscript(videoId: string): Promise<unknown[]>;
  }
}
