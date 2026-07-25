export type Author = {
  name: string
  github?: string
  linkedin?: string
}

export const site = {
  docs: "https://github.com/0xbri3t/Agora",
  authors: [
    {
      name: "Arnau Briet",
      github: "https://github.com/0xbri3t",
      linkedin: "https://www.linkedin.com/in/arnau-briet/",
    },
  ] as Author[],
}
