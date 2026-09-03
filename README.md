# Awesome Jobflo Addons

A curated, community-maintained registry of addons for [Jobflo](https://github.com/jsrothwell) — local-first job data ingestion and parsing. Each addon plugs into Jobflo through the `@jobflo/addon-sdk` contract to ingest, parse, and normalize job data from a specific source.

Browse the registry as a web page at the [GitHub Pages showcase](https://jsrothwell.github.io/Jobflo-Addons/).

This repository is an npm workspaces monorepo containing:

- **`packages/sdk`** — [`@jobflo/addon-sdk`](packages/sdk), the TypeScript SDK addons are built against.
- **`addons/`** — the registry of community addons, including the [`starter-template`](addons/starter-template) reference implementation.
- **`docs/`** — the GitHub Pages showcase site, generated from each addon's `manifest.json` via `npm run build:registry`.

## Addon Index

| Addon | Description | Author | Version |
| ----- | ----------- | ------ | ------- |
| [`linkedin-posting-text`](addons/linkedin-posting-text) | Parses the plain text of a LinkedIn job posting's detail panel (company, title, location, badges, About the job) into a normalized job | jsrothwell | 1.0.0 |
| [`schema-org-jobposting`](addons/schema-org-jobposting) | Parses schema.org JobPosting JSON-LD out of pasted job page HTML — works across Greenhouse, Lever, Workday, LinkedIn, Indeed, and most ATS platforms | jsrothwell | 1.0.0 |
| [`starter-template`](addons/starter-template) | Reference implementation demonstrating the `defineAddon` contract | jsrothwell | 1.0.0 |

*Building an addon? Add a row here as part of your Pull Request.*

## Quickstart

Clone the repo and install dependencies for all workspaces:

```bash
git clone https://github.com/jsrothwell/Jobflo-Addons.git
cd Jobflo-Addons
npm install
npm run build
```

Explore the SDK types and helper:

```ts
import { defineAddon } from "@jobflo/addon-sdk";
```

Use [`addons/starter-template`](addons/starter-template) as the base for a new addon.

## Building an Addon

1. **Scaffold** a new folder under `addons/<your-addon-name>`, copying the structure of `addons/starter-template`.
2. **Add the SDK** as a dependency in your addon's `package.json`:
   ```json
   "dependencies": {
     "@jobflo/addon-sdk": "*"
   }
   ```
3. **Implement the contract** using `defineAddon()` from `@jobflo/addon-sdk`, providing:
   - An `AddonManifest` (id, name, version, description, author, permissions, targetEvents).
   - A `parse` implementation that turns a `DataIngestPayload` into a `ParserResult`.
4. **Add a `manifest.json`** at the root of your addon folder (see `addons/starter-template/manifest.json`) — this powers the registry showcase site and needs `id`, `name`, `description`, `author`, `version`, and optional `category`/`tags`.
5. **Keep it local-first.** Addons should not require network access to function; declare any required `permissions` explicitly in the manifest.
6. **Type-check** your addon: `npm run build --workspace=addons/<your-addon-name>`.

## Submitting an Addon (Pull Request Guidelines)

1. Fork this repository and create a branch for your addon.
2. Add your addon under `addons/<your-addon-name>` following the steps above.
3. Ensure `npm run build` succeeds with zero errors across the whole workspace.
4. Add a row for your addon to the **Addon Index** table above.
5. Open a Pull Request describing:
   - What data source(s) your addon supports.
   - What permissions it requires and why.
   - Any setup or configuration steps for users.
6. A maintainer will review for SDK compliance, security (declared permissions match actual behavior), and code quality before merging.

## License

[MIT](LICENSE)
