import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

function postIndexPlugin() {
  return {
    name: 'post-index',
    closeBundle() {
      const outDir = resolve(__dirname, 'docs');
      const postsDir = resolve(__dirname, 'posts');

      // 1. 生成 posts.json
      const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md')).sort().reverse();
      const index = files.map(f => {
        const content = fs.readFileSync(resolve(postsDir, f), 'utf-8');
        const match = f.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
        const date = match ? match[1] : '';
        const slug = match ? match[2] : f.replace('.md', '');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : slug;
        const excerptMatch = content.match(/^(.+?)\n\n/s);
        const excerpt = excerptMatch
          ? excerptMatch[1].replace(/^[#>\s]+/, '').trim().slice(0, 200)
          : '';
        return { title, date, slug, url: `/post/${slug}/`, excerpt };
      });

      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(resolve(outDir, 'posts.json'), JSON.stringify(index, null, 2));
      console.log(`📝 Indexed ${index.length} posts`);

      // 2. 复制 CNAME
      const cnameSrc = resolve(__dirname, 'public', 'CNAME');
      if (fs.existsSync(cnameSrc)) {
        fs.copyFileSync(cnameSrc, resolve(outDir, 'CNAME'));
      }

      // 3. SPA fallback: index 复制为 404.html
      const indexSrc = resolve(outDir, 'index.html');
      if (fs.existsSync(indexSrc)) {
        fs.copyFileSync(indexSrc, resolve(outDir, '404.html'));
        console.log('🔄 Created 404.html for SPA fallback');
      }

      // 4. 复制 markdown 文件到 dist (用于前端 fetch 加载)
      const postsOut = resolve(outDir, 'posts');
      fs.mkdirSync(postsOut, { recursive: true });
      fs.readdirSync(postsDir).forEach(f => {
        if (f.endsWith('.md')) {
          fs.copyFileSync(resolve(postsDir, f), resolve(postsOut, f));
        }
      });
      console.log(`📄 Copied ${files.length} markdown files`);
    }
  };
}

export default defineConfig({
  root: '.',
  base: '/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  plugins: [postIndexPlugin()],
  server: {
    port: 3000,
    historyApiFallback: true,
  },
});
