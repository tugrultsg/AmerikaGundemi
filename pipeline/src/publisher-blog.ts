import simpleGit from 'simple-git';
import { resolve } from 'node:path';
import { updateVideoStatus } from './db.js';
import { logger } from './logger.js';
import { PROJECT_ROOT } from './config.js';

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
    // Stage all new/modified post files
    const postsGlob = 'blog/src/content/posts/*.md';
    await git.add(postsGlob);

    // Check if there are staged changes
    const status = await git.status();
    if (status.staged.length === 0) {
      logger.info('No staged changes to commit');
      return true;
    }

    // Single commit for all posts
    const titleList = titles.slice(0, 3).join(', ');
    const suffix = titles.length > 3 ? `, +${titles.length - 3} more` : '';
    const message = `Add ${videoIds.length} new post${videoIds.length > 1 ? 's' : ''}: ${titleList}${suffix}`;

    await git.commit(message);
    await git.push('origin', 'main');

    // Update status for all published videos
    const publishedAt = new Date().toISOString();
    for (const videoId of videoIds) {
      updateVideoStatus(videoId, 'blog_published', { published_at: publishedAt });
    }

    logger.info({ count: videoIds.length, message }, 'Blog posts published');
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ error: errorMsg }, 'Failed to publish blog posts');
    return false;
  }
}
