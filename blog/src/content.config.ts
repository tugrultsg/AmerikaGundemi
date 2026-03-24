import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    source: z.string().url(),
    channel: z.string(),
    videoId: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    guests: z.array(z.string()),
    category: z.string(),
    readingTime: z.object({
      summary: z.number(),
      full: z.number(),
    }),
  }),
});

export const collections = { posts };
