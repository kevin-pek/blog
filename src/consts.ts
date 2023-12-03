// Website metadata
export const SITE_URL: string = "https://blog.kevinpek.com"
export const SITE_TITLE: string = "Kevin Pek's Blog"
export const SITE_DESCRIPTION: string = "Welcome to my blog! I write about random projects I work on here, and any topic I'm interested in."

// Repo info
export const REPO: string = "kevin-pek/blog"
export const DEFAULT_BRANCH: string = "main"

// Navigation
type Page = {
  title: string
  href: string
  children?: Page[]
}

export const PAGES: Page[] = [
  {
    title: "Kevin Pek's Blog",
    href: "/",
  },
]
