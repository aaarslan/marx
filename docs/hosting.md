# Website hosting

The public site lives in `website/`, separate from developer documentation and historical evidence. It uses system fonts, local scripts, synthetic screenshots and a committed 52-second MP4. No backend, API keys, analytics or remote render job is required.

## Preview and check

```sh
bun run verify:site
bun run site:build
python3 -m http.server 4173 --bind 127.0.0.1 --directory .cache/website
```

Open `http://127.0.0.1:4173/`. The build copies only the public site to ignored staging and pins GitHub documentation links to the source commit, so an unmerged preview links to the correct build instructions. `source.json` records the source revision without machine-specific data.

## Publish

Commit and review changes first, then run:

```sh
bun run site:publish
```

The publisher requires a clean checkout and a GitHub noreply commit identity. It pushes a separate `gh-pages` branch containing only the staged site, preserving its deployment history. It neither merges the application branch nor adds a workflow file. Repeating publication of the same content is a no-op; a concurrent branch change causes a normal non-fast-forward rejection rather than a forced overwrite.

In repository **Settings → Pages**, choose **Deploy from a branch**, **gh-pages**, and **/ (root)**. The project URL is `https://aaarslan.github.io/marx/`. Future application merges do not implicitly publish the site: publish a reviewed clean revision explicitly.

GitHub Pages supports public repositories on GitHub Free. Its managed branch deployment handles hosting without a custom Actions workflow. See [publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [availability and limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) and [Pages settings](https://github.com/aaarslan/marx/settings/pages).

The publishing script is scoped to the Marx repository. For a fork, update its remote check, source/social URLs and the 404 page before publishing. Never copy profiles, credentials, real exports or private screenshots into `website/`.

Rebuild product media using [the showcase instructions](../showcase/README.md). Generated renderer state and tooling remain ignored.
