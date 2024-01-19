import { defineCollection, z } from "astro:content"
import { parse, isValid } from "date-fns"

const parseOptionalDateFormat = (dateString: string | undefined) => {
  if (typeof dateString !== "string" || dateString.trim() === "") {
    return undefined // or throw an error if you want to enforce a valid date string
  }

  const parsedDate = parse(dateString, "dd-MM-yyyy", new Date())
  if (!isValid(parsedDate)) {
    throw new Error("Invalid date format")
  }
  return parsedDate
}

const parseCustomDateFormat = (dateString: string) => {
  const parsedDate = parse(dateString, "yyyy-MM-dd", new Date())
  if (!isValid(parsedDate)) {
    throw new Error("Invalid date format")
  }
  return parsedDate
}

const blog = defineCollection({
  // Type-check frontmatter using a schema
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string().optional(),
      publishDate: z.date(),
      updatedDate: z.date().optional(),
      heroImage: image().optional(),
    }),
})

export const collections = { blog }
