import { TwitterApi } from 'twitter-api-v2';
import { getDb, updateVideoStatus } from './db.js';
import { logger } from './logger.js';
import type { SocialPublisher } from './types.js';

export class TwitterPublisher implements SocialPublisher {
  private client: TwitterApi;

  constructor() {
    this.client = new TwitterApi({
      appKey: process.env.TWITTER_APP_KEY!,
      appSecret: process.env.TWITTER_APP_SECRET!,
      accessToken: process.env.TWITTER_ACCESS_TOKEN!,
      accessSecret: process.env.TWITTER_ACCESS_SECRET!,
    });
  }

  async postThread(thread: string[], _blogUrl: string): Promise<string[]> {
    const tweetIds: string[] = [];
    let lastTweetId: string | undefined;

    for (let i = 0; i < thread.length; i++) {
      const tweet = thread[i];

      try {
        let result;
        if (lastTweetId) {
          result = await this.client.v2.reply(tweet, lastTweetId);
        } else {
          result = await this.client.v2.tweet(tweet);
        }

        lastTweetId = result.data.id;
        tweetIds.push(lastTweetId);

        logger.info({ tweetIndex: i + 1, total: thread.length, tweetId: lastTweetId }, 'Tweet posted');

        // Delay between tweets to avoid rate limits
        if (i < thread.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Check for rate limit
        if (message.includes('429') || message.includes('Too Many')) {
          logger.warn({ tweetIndex: i + 1 }, 'Rate limited, waiting 60 seconds');
          await new Promise((r) => setTimeout(r, 60_000));
          i--; // Retry this tweet
          continue;
        }

        logger.error({ tweetIndex: i + 1, error: message }, 'Failed to post tweet');
        throw err;
      }
    }

    return tweetIds;
  }
}

export async function publishTwitterThread(
  videoId: string,
  thread: string[],
  blogUrl: string,
): Promise<boolean> {
  // Check if Twitter credentials are configured
  if (!process.env.TWITTER_APP_KEY) {
    logger.warn('Twitter credentials not configured, skipping');
    return false;
  }

  try {
    const publisher = new TwitterPublisher();
    const tweetIds = await publisher.postThread(thread, blogUrl);

    // Store tweet IDs in database
    const db = getDb();
    db.prepare('INSERT INTO twitter_posts (video_id, tweet_ids) VALUES (?, ?)').run(
      videoId,
      JSON.stringify(tweetIds),
    );

    updateVideoStatus(videoId, 'twitter_published');
    logger.info({ videoId, tweets: tweetIds.length }, 'Twitter thread published');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ videoId, error: message }, 'Failed to publish Twitter thread');
    return false;
  }
}
