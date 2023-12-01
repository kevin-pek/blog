import { defineConfig } from "astro/config"

import alpinejs from "@astrojs/alpinejs"
import tailwind from "@astrojs/tailwind"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"

// https://astro.build/config
export default defineConfig({
  site: "https://blog.kevinpek.com",
  integrations: [tailwind(), mdx(), sitemap(), alpinejs()],
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
})
