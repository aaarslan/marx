# Host the Marx showcase with GitHub Pages

The static site is ready in `docs/`. It uses relative asset URLs so it works at `https://aaarslan.github.io/marx/` and under another repository prefix. It needs no build server, backend, analytics, external fonts or API keys. The committed MP4 plays locally from the site.

After this branch is reviewed and merged:

1. Open repository **Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Select **main** and **/docs**, then save.
4. Wait for GitHub to publish and check the reported URL.

GitHub Pages is available for public repositories on GitHub Free. See the official [publishing source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). No custom GitHub Actions workflow is required. This change does not enable hosting or claim the site is live.

Preview locally from the repository:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:4173/`. The guide is `walkthrough.html`; Markdown is also available at `walkthrough.md`. If you fork or rename the repository, update canonical/social URLs and GitHub links in the HTML. Pages serves public material: never copy profiles, credentials, real scan exports or private screenshots into this directory.

Rebuild the film using [the showcase instructions](../showcase/README.md). Committing generated media allows branch-based Pages to serve it without a render job.
