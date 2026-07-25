"use client"

import Link from "next/link"
import { Github, Linkedin } from "lucide-react"
import { site, type Author } from "@/lib/site"

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-transparent">
      <div className="container mx-auto px-4 py-8 grid gap-8 md:grid-cols-3">
        <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">FutarFi</h3>
          <Link
            href={site.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-primary transition-colors"
          >
            {site.website.replace(/^https?:\/\//, "")}
          </Link>
          <p className="text-sm text-muted-foreground">Futarchy as a Service</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Documentation</h3>
          <Link
            href={site.docs}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-primary transition-colors"
          >
            View docs
          </Link>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Developed by</h3>
          <ul className="space-y-2">
            {site.authors.map((author: Author) => (
              <li key={author.name} className="flex items-center gap-2">
                <span className="text-foreground">{author.name}</span>
                <span className="flex items-center gap-2 ml-2">
                  {author.github && (
                    <Link
                      href={author.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${author.name} on GitHub`}
                      title={`${author.name} on GitHub`}
                      className="text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Github className="h-4 w-4" />
                    </Link>
                  )}
                  {author.linkedin && (
                    <Link
                      href={author.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${author.name} on LinkedIn`}
                      title={`${author.name} on LinkedIn`}
                      className="text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Linkedin className="h-4 w-4" />
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="container mx-auto px-4 pb-8 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} FutarFi</span>
      </div>
    </footer>
  )
}
