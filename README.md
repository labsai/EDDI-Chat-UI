# EDDI Chat UI — moved to labsai/EDDI

> [!IMPORTANT]
> **This repository is archived and read-only.** The EDDI Chat UI now lives in the main EDDI
> repository, at **[`labsai/EDDI` → `ui/chat`](https://github.com/labsai/EDDI/tree/main/ui/chat)**.
> Its full commit history came with it. Nothing here is maintained any more.

The EDDI Chat UI is the embeddable chat widget for [EDDI](https://github.com/labsai/EDDI), the
open-source multi-agent orchestration middleware for conversational AI. It has always shipped inside
the EDDI Docker image. Since September 2026 it is also developed, tested and released there, in the
same repository as the backend it talks to.

**🌐 Website:** [eddi.technology](https://eddi.technology/) · **📖 Docs:** [docs.labs.ai](https://docs.labs.ai/) · **🐳 Docker:** [hub.docker.com/r/labsai/eddi](https://hub.docker.com/r/labsai/eddi)

---

## Where everything went

| You are looking for | It is now |
| --- | --- |
| The source | [`labsai/EDDI/ui/chat`](https://github.com/labsai/EDDI/tree/main/ui/chat) |
| The README: features, URL patterns, configuration | [`ui/chat/README.md`](https://github.com/labsai/EDDI/blob/main/ui/chat/README.md) |
| Embedding the widget in your own page | [`ui/chat/README.md` → Embedding](https://github.com/labsai/EDDI/blob/main/ui/chat/README.md#-embedding) |
| How to contribute | The repository-wide [`CONTRIBUTING.md`](https://github.com/labsai/EDDI/blob/main/CONTRIBUTING.md) |
| Instructions for AI coding assistants | [`ui/chat/AGENTS.md`](https://github.com/labsai/EDDI/blob/main/ui/chat/AGENTS.md) |
| Bug reports and feature requests | [`labsai/EDDI` issues](https://github.com/labsai/EDDI/issues) |
| Pull requests | [`labsai/EDDI` pull requests](https://github.com/labsai/EDDI/pulls), changing files under `ui/chat/` |
| Reporting a security vulnerability | [`SECURITY.md`](https://github.com/labsai/EDDI/blob/main/SECURITY.md): privately, to **security@labs.ai**, never in a public issue |
| A running Chat UI | Install EDDI and open `http://localhost:7070/chat`: [EDDI quick start](https://github.com/labsai/EDDI#-quick-start) |

## What changed for developers

- **One repository, one pull request.** A change that touches both the backend API and the Chat UI
  is now one pull request, tested together in CI against the image built from that commit.
- **The Chat UI is built by Maven.** `./mvnw package` in `labsai/EDDI` runs `npm ci` and
  `npm run build` for the Chat UI and copies the bundle into the jar. Nothing is committed as a build
  output any more.
- **Frontend development is unchanged.** In a clone of `labsai/EDDI`, `cd ui/chat`, then
  `npm install` and `npm run dev` (port 5174, proxying the API to an EDDI on port 7070).

## The history

Every commit from this repository is in `labsai/EDDI` under `ui/chat/`, with its original author,
date and message:

```bash
git clone https://github.com/labsai/EDDI.git
cd EDDI
git log -- ui/chat
```

`git blame` and `git log --follow` work on those files as they did here. **Commit hashes are not the
same**, though: moving the files into `ui/chat/` rewrote every commit, so a link to a commit in this
repository does not resolve in `labsai/EDDI`. Search that history by message instead:
`git log --grep="<words from the message>" -- ui/chat`.

## Moving an unmerged branch across

Pull requests still open here were not carried over. To bring a branch into `labsai/EDDI`, export
its commits as patches and apply them under the new path:

```bash
# In your clone of this repository, on the branch
git format-patch master --output-directory ../chat-patches

# In a clone of labsai/EDDI, on a new branch from main
git switch -c my-branch origin/main
git am --directory=ui/chat --exclude='ui/chat/dist/*' ../chat-patches/*.patch
```

`--directory=ui/chat` places every path in a patch under `ui/chat/`. Everything in this repository
moved there except the committed build output in `dist/`: `labsai/EDDI` builds the Chat UI with
Maven and commits no build output, so a patch that touched `dist/` would stop `git am` without the
`--exclude`. The pattern names the path *after* `--directory` has prefixed it, which is why it starts
with `ui/chat/`. If a patch no longer applies because the code has moved on, `git am --3way` usually
resolves it.

## License

[Apache 2.0](https://github.com/labsai/EDDI/blob/main/LICENSE)
