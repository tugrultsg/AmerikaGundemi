import simpleGit from 'simple-git';
import { resolve } from 'node:path';
import { updateVideoStatus } from './db.js';
import { logger } from './logger.js';
import { PROJECT_ROOT } from './config.js';

function buildPublishMessage(videoIds: string[], titles: string[]): string {
  const titleList = titles.slice(0, 3).join(', ');
  const suffix = titles.length > 3 ? `, +${titles.length - 3} more` : '';
  return `Add ${videoIds.length} new post${videoIds.length > 1 ? 's' : ''}: ${titleList}${suffix}`;
}

function markVideosPublished(videoIds: string[]): void {
  const publishedAt = new Date().toISOString();
  for (const videoId of videoIds) {
    updateVideoStatus(videoId, 'blog_published', { published_at: publishedAt });
  }
}

export async function publishBlogPosts(
  videoIds: string[],
  titles: string[],
): Promise<boolean> {
  if (videoIds.length === 0) {
    logger.info('No blog posts to publish');
    return true;
  }

  const git = simpleGit(PROJECT_ROOT);

  try {
    const branch = (await git.branch()).current;
    if (branch !== 'main') {
      logger.error({ branch }, 'Refusing to publish blog posts from a non-main branch');
      return false;
    }

    // Stage all new/modified post files
    const postsGlob = 'blog/src/content/posts/*.md';
    await git.add(postsGlob);

    // Check if there are staged changes
    const status = await git.status();
    if (status.staged.length === 0) {
      await git.fetch('origin', 'main');
      const aheadRaw = await git.raw(['rev-list', '--count', 'origin/main..HEAD']);
      const aheadCount = Number.parseInt(aheadRaw.trim(), 10) || 0;

      if (aheadCount > 0) {
        await git.push('origin', 'main');
      }

      markVideosPublished(videoIds);
      logger.info({ count: videoIds.length, aheadCount }, 'No staged changes; marked posts published');
      return true;
    }

    // Single commit for all posts
    const message = buildPublishMessage(videoIds, titles);

    await git.commit(message);
    await git.push('origin', 'main');

    // Update status for all published videos
    markVideosPublished(videoIds);

    logger.info({ count: videoIds.length, message }, 'Blog posts published');
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ error: errorMsg }, 'Failed to publish blog posts');
    return false;
  }
}
